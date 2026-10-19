import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { z } from "zod";
import * as schemas from "../schemas.ts";
import { toGeminiSchema, UnsupportedSchemaError } from "./json-schema.ts";

describe("toGeminiSchema", () => {
  test("every model output schema converts to Gemini's subset", () => {
    const outputs = Object.entries(schemas).filter(([name, value]) => name.endsWith("Schema") && value instanceof z.ZodObject);
    assert.ok(outputs.length >= 8, "expected the output schemas from lib/schemas.ts");
    for (const [name, schema] of outputs) assert.doesNotThrow(() => toGeminiSchema(schema as z.ZodType), name);
  });

  test("drops the dialect and Zod's safe-integer bounds, keeps real bounds", () => {
    const converted = toGeminiSchema(z.object({ slot: z.number().int(), score: z.number().min(0).max(10) }));
    assert.equal(converted.$schema, undefined);
    assert.deepEqual(converted.properties, { slot: { type: "integer" }, score: { type: "number", minimum: 0, maximum: 10 } });
  });

  test("nullable values become type arrays, with null added to an enum", () => {
    const converted = toGeminiSchema(
      z.object({ unit: z.string().nullable(), count: z.number().int().nullable(), level: z.enum(["easy", "hard"]).nullable() }),
    );
    assert.deepEqual(converted.properties, {
      unit: { type: ["string", "null"] },
      count: { type: ["integer", "null"] },
      level: { type: ["string", "null"], enum: ["easy", "hard", null] },
    });
  });

  test("the generated-question schema keeps its required fields and nested items", () => {
    const converted = toGeminiSchema(schemas.SlotQuestionsSchema);
    const question = (converted.properties as { questions: { items: { required: string[]; properties: Record<string, unknown> } } }).questions.items;
    assert.ok(question.required.includes("option_explanations"));
    assert.deepEqual(question.properties.options, { type: ["array", "null"], items: { type: "string" } });
  });

  test("unions and unsupported keywords throw instead of being sent", () => {
    assert.throws(() => toGeminiSchema(z.object({ v: z.union([z.string(), z.number()]) })), UnsupportedSchemaError);
    assert.throws(() => toGeminiSchema(z.object({ code: z.string().regex(/^[A-Z]+$/) })), /doesn't support "pattern"/);
    assert.throws(() => toGeminiSchema(z.object({ name: z.string().min(1) })), /doesn't support "minLength"/);
  });
});
