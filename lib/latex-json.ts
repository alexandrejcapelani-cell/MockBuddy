// Repairs LaTeX that JSON string escaping breaks.
//
// Models often write a single backslash before a LaTeX command inside a JSON string.
// Two things then go wrong:
//   - `\h`, `\s`, `\(`, `\[` … are not JSON escapes, so JSON.parse throws.
//   - `\b`, `\f`, `\n`, `\r`, `\t` ARE JSON escapes, so `\beta` silently parses as a
//     backspace followed by "eta", `\frac` as a form feed plus "rac", `\theta` as a tab…
// repairLatexEscapes fixes both in the raw JSON text before parsing.
// restoreLatexControlChars is a second net for strings that were already parsed.

// LaTeX commands starting with a JSON escape letter (b, f, n, r, t). Only an exact match
// of the whole letter run counts as LaTeX, so "\nThe next line" stays a newline.
const KNOWN_COMMANDS = new Set([
  // b
  "backslash", "bar", "beta", "begin", "bf", "big", "bigg", "biggl", "biggr", "bigl", "bigr",
  "binom", "bm", "boldsymbol", "bot", "boxed", "breve", "bullet",
  // f
  "flat", "forall", "frac",
  // n
  "nabla", "ne", "neg", "neq", "newline", "ngeq", "ni", "nleq", "nmid", "nolimits", "not",
  "notin", "nu",
  // r
  "rangle", "rbrace", "rceil", "rfloor", "rho", "right", "rightarrow", "rm", "rvert", "rVert",
  // t
  "tan", "tanh", "tau", "text", "textbf", "textit", "textrm", "textstyle", "tfrac",
  "therefore", "theta", "tilde", "times", "to", "top", "triangle",
]);

const ESCAPE_LETTERS = new Set(["b", "f", "n", "r", "t"]);
const CONTROL_TO_LETTER: Record<string, string> = { "\b": "b", "\f": "f", "\n": "n", "\r": "r", "\t": "t" };

/** Doubles backslashes inside JSON strings wherever they start a LaTeX command or are invalid escapes. */
export function repairLatexEscapes(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (!inString || char !== "\\") {
      if (char === '"') inString = !inString;
      out += char;
      continue;
    }

    const next = json[i + 1];
    if (next === "\\" || next === '"' || next === "/") {
      out += char + next; // valid escape, copied as is
      i++;
    } else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6))) {
      out += json.slice(i, i + 6); // é
      i += 5;
    } else if (next !== undefined && ESCAPE_LETTERS.has(next) && !KNOWN_COMMANDS.has(letterRun(json, i + 1))) {
      out += char + next; // a genuine \n, \t …
      i++;
    } else {
      // \beta, \frac, \nu, \theta (LaTeX that happens to look like an escape), \underline,
      // and everything that is not a JSON escape at all: \hat, \sigma, \(, \[, \{ …
      out += "\\\\";
    }
  }
  return out;
}

function letterRun(text: string, start: number): string {
  let end = start;
  while (end < text.length && /[A-Za-z]/.test(text[end])) end++;
  return text.slice(start, end);
}

/**
 * Restores LaTeX commands that a JSON parse turned into control characters. Backspace and
 * form feed never belong in exam text, so they are restored anywhere; newline, carriage
 * return and tab only inside \( … \) or \[ … \].
 */
export function restoreLatexControlChars<T>(value: T): T {
  if (typeof value === "string") return restoreInString(value) as T;
  if (Array.isArray(value)) return value.map((item) => restoreLatexControlChars(item)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, restoreLatexControlChars(item)]),
    ) as T;
  }
  return value;
}

function restoreInString(text: string): string {
  const restore = (match: string, control: string, rest: string) => {
    const word = CONTROL_TO_LETTER[control] + rest;
    return KNOWN_COMMANDS.has(word) ? `\\${word}` : match;
  };
  return text
    .replace(/([\b\f])([A-Za-z]*)/g, restore)
    .replace(/\\\(.*?\\\)|\\\[.*?\\\]/gs, (segment) => segment.replace(/([\n\r\t])([A-Za-z]+)/g, restore));
}
