import "server-only";
import { desc, eq } from "drizzle-orm";
import { type CallMetrics, generateValidatedJson, schemaText } from "@/lib/ai/call";
import { EFFORT, MAX_TOKENS } from "@/lib/ai/config";
import { db } from "@/lib/db";
import { blueprints } from "@/lib/db/schema";
import { classifyUpload, isOwnedStoragePath } from "@/lib/files";
import { DocumentError, extractDocument } from "@/lib/ingest/extract";
import { IngestError } from "@/lib/ingest/ingest";
import { BlueprintSchema } from "@/lib/schemas";
import { storage } from "@/lib/storage";
import { BLUEPRINT_SYSTEM, blueprintPrompt } from "./prompt";
import { blueprintIssues, MAX_SAMPLE_TEXT_CHARS, toStoredBlueprint } from "./rules";

export type BlueprintRow = typeof blueprints.$inferSelect;

/**
 * Stage B: reads the uploaded sample exam and stores its blueprint. The newest blueprint
 * is the active one, so uploading another sample replaces it. The sample exam's text is
 * never chunked into the material pool.
 */
export async function createBlueprint(
  userId: string,
  storagePath: string,
  filename: string,
  deadlineAt: number | undefined,
): Promise<{ blueprint: BlueprintRow; calls: CallMetrics[] }> {
  if (!isOwnedStoragePath(storagePath, userId, "sample")) {
    throw new IngestError("That storage path wasn't issued for your sample exam upload.", 400);
  }
  const check = classifyUpload(filename);
  if (!check.ok) throw new IngestError(check.message, 415);

  const document = await extractDocument(await storage.read(storagePath), check.kind);
  const paperText = document.pages.join("\n\n").trim();
  if (paperText.length > MAX_SAMPLE_TEXT_CHARS) {
    throw new DocumentError(
      `This paper is too long to use as a sample (${Math.round(paperText.length / 1000)}k characters). Upload a single past exam or mock.`,
    );
  }

  const { data, calls } = await generateValidatedJson(
    {
      context: { label: "blueprint", filename },
      schema: BlueprintSchema,
      system: [{ type: "text", text: BLUEPRINT_SYSTEM }],
      messages: [{ role: "user", content: blueprintPrompt(paperText, filename, schemaText(BlueprintSchema)) }],
      effort: EFFORT.blueprint,
      maxTokens: MAX_TOKENS.blueprint,
      deadlineAt,
    },
    (blueprint) => blueprintIssues(blueprint, paperText),
  );

  const { spec, sampleQuestions } = toStoredBlueprint(data);
  const [blueprint] = await db()
    .insert(blueprints)
    .values({ userId, sourceFilename: filename, storagePath, spec, sampleQuestions })
    .returning();
  return { blueprint, calls };
}

export async function activeBlueprint(userId: string): Promise<BlueprintRow | null> {
  const [latest] = await db()
    .select()
    .from(blueprints)
    .where(eq(blueprints.userId, userId))
    .orderBy(desc(blueprints.createdAt))
    .limit(1);
  return latest ?? null;
}
