import { repairLatexEscapes, restoreLatexControlChars } from "../latex-json.ts";

/** Removes a ```json … ``` wrapper if the model added one despite being told not to. */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string };

/** Fence stripping, LaTeX escape repair, JSON.parse, then a second LaTeX pass over the strings. */
export function parseModelJson(text: string): ParsedJson {
  const body = stripFences(text);
  if (body === "") return { ok: false, error: "The response was empty." };
  try {
    return { ok: true, value: restoreLatexControlChars(JSON.parse(repairLatexEscapes(body))) };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: `The response was not valid JSON: ${error.message}` };
    throw error;
  }
}
