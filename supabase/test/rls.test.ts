import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Runs supabase/setup.sql (the SQL pasted into Supabase) on Postgres with Supabase's roles,
// auth.uid() and Storage tables emulated, then checks what each role can read and write.
// The grading contract: RLS on every table, policies on auth.uid(), nothing readable signed out.

const TABLES = ["subjects", "materials", "chunks", "blueprints", "exams", "generation_batches", "questions", "answers"];
const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";

const db = new PGlite();

async function seed(user: string, tag: string) {
  const one = async (sql: string, params: unknown[]) => ((await db.query<{ id: string }>(sql, params)).rows[0] as { id: string }).id;
  await db.query("insert into auth.users (id, email) values ($1, $2)", [user, `${tag}@test`]);
  const subject = await one("insert into subjects (user_id, name) values ($1, $2) returning id", [user, `${tag} subject`]);
  const material = await one("insert into materials (user_id, subject_id, filename, storage_path) values ($1, $2, 'f.pdf', $3) returning id", [user, subject, `${user}/materials/x/f.pdf`]);
  const chunk = await one("insert into chunks (material_id, ordinal, section_label, content, token_estimate) values ($1, 1, 's', 'c', 1) returning id", [material]);
  const blueprint = await one("insert into blueprints (user_id, subject_id, source_filename, storage_path, spec, sample_questions) values ($1, $2, 'e.pdf', 'p', '{}', '[]') returning id", [user, subject]);
  const exam = await one("insert into exams (user_id, subject_id, blueprint_id, question_count, difficulty, generation_seed, plan) values ($1, $2, $3, 5, 'same', 1, '{}') returning id", [user, subject, blueprint]);
  await db.query("insert into generation_batches (exam_id, batch_index, kind, slot_ordinals) values ($1, 0, 'initial', '[]')", [exam]);
  const question = await one("insert into questions (exam_id, ordinal, type, prompt, marks, correct_explanation, worked_solution, source_chunk_id, source_excerpt, topic_label, difficulty) values ($1, 1, 'mcq', 'p', 1, 'x', 'x', $2, 'x', 't', 'easy') returning id", [exam, chunk]);
  await db.query("insert into answers (exam_id, question_id, response, is_correct, awarded_marks) values ($1, $2, 'a', true, 1)", [exam, question]);
  await db.query("insert into storage.objects (bucket_id, name, owner) values ('uploads', $1, $2)", [`${user}/materials/x/f.pdf`, user]);
}

/** Runs `fn` as the anon role (user null) or as a signed-in user, the way PostgREST would. */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claims', $1, false)", [user ? JSON.stringify({ sub: user, role: "authenticated" }) : ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

const count = async (table: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n);
const counts = async () => Object.fromEntries(await Promise.all([...TABLES, "storage.objects"].map(async (t) => [t, await count(t)])));
const refused = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
    return false;
  } catch (error) {
    return /row-level security/.test((error as Error).message);
  }
};

describe("supabase/setup.sql row level security", () => {
  before(async () => {
    await db.exec(readFileSync("supabase/test/emulate-supabase.sql", "utf8"));
    await db.exec(readFileSync("supabase/setup.sql", "utf8"));
    await seed(ALICE, "alice");
    await seed(BOB, "bob");
  });
  after(() => db.close());

  test("RLS is on for every public table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
    );
    assert.deepEqual(rows.map((r) => r.relname).sort(), [...TABLES].sort());
    for (const row of rows) assert.ok(row.relrowsecurity, `${row.relname} has RLS off`);
  });

  test("every policy is a SELECT for authenticated users, keyed to auth.uid()", async () => {
    const { rows } = await db.query<{ tablename: string; cmd: string; roles: string; qual: string }>(
      "select tablename, cmd, roles::text as roles, qual from pg_policies where schemaname = 'public'",
    );
    assert.equal(rows.length, TABLES.length);
    for (const row of rows) {
      assert.equal(row.cmd, "SELECT", row.tablename);
      assert.equal(row.roles, "{authenticated}", row.tablename);
      assert.match(row.qual, /auth\.uid\(\)/, row.tablename);
    }
  });

  test("signed out (anon), nothing can be read: no rows, no files", async () => {
    const seen = await as(null, counts);
    for (const [table, n] of Object.entries(seen)) assert.equal(n, 0, table);
  });

  test("each user reads exactly their own rows and files, including through parent rows", async () => {
    for (const user of [ALICE, BOB]) {
      const seen = await as(user, counts);
      for (const [table, n] of Object.entries(seen)) assert.equal(n, 1, `${table} as ${user}`);
    }
    assert.deepEqual(await as(ALICE, async () => (await db.query<{ name: string }>("select name from subjects")).rows.map((r) => r.name)), ["alice subject"]);
  });

  test("nobody can write tables through the Data API, so the free-mock quota can't be skipped", async () => {
    assert.ok(await as(ALICE, () => refused("insert into subjects (user_id, name) values ($1, 'x')", [ALICE])));
    assert.ok(
      await as(ALICE, () =>
        refused("insert into exams (user_id, subject_id, blueprint_id, question_count, difficulty, generation_seed, plan) select user_id, subject_id, id, 5, 'same', 1, '{}' from blueprints"),
      ),
    );
    await as(ALICE, () => db.query("update subjects set name = 'hijacked'"));
    await as(ALICE, () => db.query("delete from exams"));
    assert.equal(await count("exams"), 2, "an update or delete through the Data API changed rows");
    assert.equal((await db.query("select 1 from subjects where name = 'hijacked'")).rows.length, 0);
  });

  test("storage: users add and delete files only in their own folder", async () => {
    assert.ok(!(await as(ALICE, () => refused("insert into storage.objects (bucket_id, name) values ('uploads', $1)", [`${ALICE}/samples/y/e.pdf`]))));
    assert.ok(await as(ALICE, () => refused("insert into storage.objects (bucket_id, name) values ('uploads', $1)", [`${BOB}/samples/y/e.pdf`])));
    await as(ALICE, () => db.query("delete from storage.objects where name like $1", [`${BOB}/%`]));
    assert.equal((await db.query("select 1 from storage.objects where name like $1", [`${BOB}/%`])).rows.length, 1);
  });

  test("deleting a user from auth.users deletes everything they had", async () => {
    await db.query("delete from auth.users where id = $1", [ALICE]);
    assert.equal(Number((await db.query<{ n: number }>("select count(*)::int as n from subjects where user_id = $1", [ALICE])).rows[0].n), 0);
    assert.equal(await count("answers"), 1);
  });
});
