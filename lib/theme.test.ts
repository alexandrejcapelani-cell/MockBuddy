import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Every text/background pair the theme uses must reach WCAG AA (4.5:1 for text, 3:1 for
// focus rings and control borders). Reads the tokens straight from app/globals.css.

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const token = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  assert.ok(match, `--${name} is not defined as a hex colour in globals.css`);
  return match[1];
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["chip-cream", "felt-deep"],
  ["chip-cream", "felt"],
  ["chip-cream", "wood"],
  ["chip-cream", "chip-red"],
  ["chip-cream", "chip-grey"],
  ["chip-dim", "felt-deep"],
  ["chip-dim", "felt"],
  ["chip-dim", "wood"],
  ["chip-dim", "chip-grey"],
  ["gold-text", "felt-deep"],
  ["gold-text", "felt"],
  ["gold-text", "wood"],
  ["gold-bright", "wood"],
  ["felt-deep", "gold"],
  ["felt-deep", "gold-bright"],
  ["felt-deep", "chip-cream"],
  ["chip-red", "chip-cream"],
  ["error-text", "felt-deep"],
  ["error-text", "felt"],
  ["card-ink", "chip-cream"],
  ["card-ink-dim", "chip-cream"],
  ["card-link", "chip-cream"],
];

for (const [fg, bg] of TEXT_PAIRS) {
  test(`text --${fg} on --${bg} is at least 4.5:1`, () => {
    const ratio = contrast(token(fg), token(bg));
    assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1`);
  });
}

for (const bg of ["felt-deep", "felt", "wood"]) {
  test(`the gold-bright focus ring on --${bg} is at least 3:1`, () => {
    assert.ok(contrast(token("gold-bright"), token(bg)) >= 3);
  });
}

test("the spec's original values that failed are no longer used", () => {
  assert.notEqual(token("chip-dim").toLowerCase(), "#9cafa5");
  assert.ok(contrast(token("gold"), token("felt")) < 4.5, "if --gold now passes as text, --gold-text can go");
});
