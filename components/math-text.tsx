import { Fragment } from "react";
import { renderMath, splitMath } from "@/lib/math";

/** Text with LaTeX between \( \) or \[ \] rendered by KaTeX. Works in server and client components. */
export function MathText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className ?? "whitespace-pre-wrap"}>
      {splitMath(text).map((segment, i) =>
        segment.kind === "text" ? (
          <Fragment key={i}>{segment.value}</Fragment>
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: renderMath(segment) }} />
        ),
      )}
    </span>
  );
}
