import { z } from "zod";

// Gemini's structured output takes a subset of JSON Schema. This turns a Zod schema into
// exactly that subset, and throws on anything outside it, so an unsupported schema fails
// in the tests instead of being silently ignored or rejected by the API at run time.
// The full Zod schema still validates every reply, including rules this subset can't express.

export type JsonSchema = { [key: string]: unknown };

/** The keywords Gemini's structured-output docs list as supported. */
const SUPPORTED = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "enum",
  "format",
  "minimum",
  "maximum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
]);

export class UnsupportedSchemaError extends Error {
  override name = "UnsupportedSchemaError";
}

export function toGeminiSchema(schema: z.ZodType): JsonSchema {
  const root = z.toJSONSchema(schema, { io: "output", unrepresentable: "throw" }) as JsonSchema;
  delete root.$schema; // the dialect URI isn't a keyword Gemini accepts
  return simplify(root, "(root)");
}

function simplify(node: JsonSchema, path: string): JsonSchema {
  if (Array.isArray(node.anyOf)) return nullable(node, path);

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (!SUPPORTED.has(key)) throw new UnsupportedSchemaError(`${path}: Gemini's structured output doesn't support "${key}".`);
    switch (key) {
      case "properties":
        out.properties = Object.fromEntries(
          Object.entries(value as Record<string, JsonSchema>).map(([name, child]) => [name, simplify(child, `${path}.${name}`)]),
        );
        break;
      case "items":
        out.items = simplify(value as JsonSchema, `${path}[]`);
        break;
      case "prefixItems":
        out.prefixItems = (value as JsonSchema[]).map((child, i) => simplify(child, `${path}[${i}]`));
        break;
      case "additionalProperties":
        out.additionalProperties = typeof value === "boolean" ? value : simplify(value as JsonSchema, `${path}{}`);
        break;
      case "type":
        // Zod writes a union of primitives as a type array; Gemini only documents [type, "null"].
        if (Array.isArray(value) && !(value.length === 2 && value[1] === "null" && typeof value[0] === "string")) {
          throw new UnsupportedSchemaError(`${path}: Gemini's structured output doesn't support unions (type: ${JSON.stringify(value)}); only nullable values.`);
        }
        out.type = value;
        break;
      case "minimum":
      case "maximum":
        // Zod bounds every .int() to the safe-integer range; that says nothing to the model.
        if (Math.abs(value as number) !== Number.MAX_SAFE_INTEGER) out[key] = value;
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

/**
 * Zod writes `.nullable()` on anything with extra keywords as anyOf [schema, null]. Gemini
 * wants a type array instead, so that is the one anyOf this accepts; real unions throw.
 */
function nullable(node: JsonSchema, path: string): JsonSchema {
  const variants = node.anyOf as JsonSchema[];
  const isNull = (variant: JsonSchema) => variant.type === "null" && Object.keys(variant).length === 1;
  const others = Object.keys(node).filter((key) => key !== "anyOf" && key !== "description" && key !== "title");
  const nonNull = variants.filter((variant) => !isNull(variant));
  if (others.length > 0 || nonNull.length !== 1 || variants.length !== 2) {
    throw new UnsupportedSchemaError(`${path}: Gemini's structured output doesn't support unions (anyOf); only nullable values.`);
  }
  const inner = simplify(nonNull[0], path);
  if (typeof inner.type !== "string") throw new UnsupportedSchemaError(`${path}: a nullable value needs a single type.`);
  const merged: JsonSchema = { ...inner, type: [inner.type, "null"] };
  if (Array.isArray(inner.enum)) merged.enum = [...inner.enum, null];
  if (node.description !== undefined) merged.description = node.description;
  if (node.title !== undefined) merged.title = node.title;
  return merged;
}
