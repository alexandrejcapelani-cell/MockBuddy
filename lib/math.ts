import katex from "katex";

// Math notation is LaTeX between \( … \) (inline) or \[ … \] (display). A "$" is always
// a literal currency sign.

export type MathSegment = { kind: "text" | "inline" | "display"; value: string };

export function splitMath(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let rest = text;
  for (;;) {
    const open = rest.search(/\\[([]/);
    if (open === -1) break;
    const display = rest[open + 1] === "[";
    const close = rest.indexOf(display ? "\\]" : "\\)", open + 2);
    if (close === -1) break;
    if (open > 0) segments.push({ kind: "text", value: rest.slice(0, open) });
    segments.push({ kind: display ? "display" : "inline", value: rest.slice(open + 2, close) });
    rest = rest.slice(close + 2);
  }
  if (rest) segments.push({ kind: "text", value: rest });
  return segments;
}

/** Problems with the math in `text`: unclosed delimiters, $-delimited LaTeX, or LaTeX KaTeX can't render. */
export function mathProblems(text: string): string[] {
  const problems: string[] = [];
  const opens = (text.match(/\\[([]/g) ?? []).length;
  const closes = (text.match(/\\[)\]]/g) ?? []).length;
  if (opens !== closes) problems.push("has an unclosed \\( or \\[ math delimiter");
  if (/\$[^$\n]{0,80}\\[a-zA-Z]/.test(text) || /\$\$/.test(text)) {
    problems.push("uses $ for math; write math between \\( and \\) and keep $ for currency");
  }
  for (const segment of splitMath(text)) {
    if (segment.kind === "text") continue;
    try {
      katex.renderToString(segment.value, { throwOnError: true, displayMode: segment.kind === "display" });
    } catch (error) {
      if (!(error instanceof katex.ParseError)) throw error;
      problems.push(`has LaTeX that doesn't render (${segment.value.slice(0, 40)}): ${error.message.replace(/^KaTeX parse error: /, "")}`);
    }
  }
  return problems;
}

export function renderMath(segment: MathSegment): string {
  return katex.renderToString(segment.value, {
    displayMode: segment.kind === "display",
    throwOnError: false,
    output: "htmlAndMathml",
  });
}
