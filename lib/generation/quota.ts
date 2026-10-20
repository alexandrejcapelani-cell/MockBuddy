import "server-only";
import { and, count, eq, or, sql } from "drizzle-orm";
import { type Db, db } from "@/lib/db";
import { exams, questions } from "@/lib/db/schema";
import { FREE_MOCKS, FREE_MOCKS_USED_MESSAGE } from "@/lib/free-mocks";

// The free-mock quota: every account can generate FREE_MOCKS mocks,
// counted in the database per user and enforced on the server when a mock is created.
//
// A mock counts while it is generating (so starting several at once can't get past the
// limit) and once it has finished with at least one question. One that ended with no
// questions at all, because generation failed, doesn't use up a free mock.

export { FREE_MOCKS };

type Executor = Pick<Db, "select">;

export async function mocksUsed(userId: string, executor: Executor = db()): Promise<number> {
  const [{ used }] = await executor
    .select({ used: count() })
    .from(exams)
    .where(
      and(
        eq(exams.userId, userId),
        or(eq(exams.status, "generating"), sql`exists (select 1 from ${questions} where ${questions.examId} = ${exams.id})`),
      ),
    );
  return used;
}

export async function freeMocksLeft(userId: string): Promise<number> {
  return Math.max(0, FREE_MOCKS - (await mocksUsed(userId)));
}

/** Not an error to report: the account has used its free mocks. Shown as a friendly note. */
export class FreeMocksUsedError extends Error {
  override name = "FreeMocksUsedError";
  constructor() {
    super(FREE_MOCKS_USED_MESSAGE);
  }
}
