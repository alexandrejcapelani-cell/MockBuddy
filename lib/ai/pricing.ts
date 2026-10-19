// Estimated cost of a model call, from its token usage. Gemini API Standard-tier list prices
// in USD per million tokens, as published in October 2026; check Google's pricing page
// before budgeting on them. Thinking tokens are billed at the output rate.
//
// On the free tier nothing is billed, so free-tier calls cost exactly $0 and the UI says
// "free tier" rather than showing what the call would have cost on a paid key.

/** Which Gemini plan the key is on: GEMINI_TIER in .env.local (the API doesn't say). */
export type BillingTier = "free" | "paid";

interface RateCard {
  input: number;
  output: number;
  /** Implicitly cached input tokens. */
  cachedInput: number;
}

/** Rate cards in date order; a card applies from its date (UTC) until the next one. */
const PRICES: Record<string, { from: string; card: RateCard }[]> = {
  // Introductory prices until the end of 2026, then double.
  "gemini-3.8-flash": [
    { from: "2026-01-01", card: { input: 0.75, output: 3.75, cachedInput: 0.075 } },
    { from: "2027-01-01", card: { input: 1.5, output: 7.5, cachedInput: 0.15 } },
  ],
  "gemini-3.5-flash-lite": [{ from: "2026-01-01", card: { input: 0.3, output: 2.5, cachedInput: 0.03 } }],
};

export interface TokenUsage {
  /** Prompt tokens that weren't served from the cache. */
  inputTokens: number;
  cacheReadTokens: number;
  /** The visible answer. */
  outputTokens: number;
  thoughtTokens: number;
}

/** USD: 0 on the free tier, otherwise from list prices; null for a model without a price entry here. */
export function estimateCostUsd(model: string, usage: TokenUsage, tier: BillingTier, at: Date = new Date()): number | null {
  if (tier === "free") return 0;
  const cards = PRICES[model];
  if (!cards) return null;
  const day = at.toISOString().slice(0, 10);
  const card = cards.filter((entry) => entry.from <= day).at(-1)?.card ?? cards[0].card;
  const usd =
    usage.inputTokens * card.input +
    usage.cacheReadTokens * card.cachedInput +
    (usage.outputTokens + usage.thoughtTokens) * card.output;
  return usd / 1_000_000;
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export interface CallSummaryInput {
  model: string;
  servedBy: string | null;
  durationMs: number;
  billingTier: BillingTier;
  estimatedCostUsd: number | null;
}

/** "free tier" when every call was free, otherwise "≈$0.0021" (calls without a price count as $0). */
export function formatCost(calls: Pick<CallSummaryInput, "billingTier" | "estimatedCostUsd">[]): string {
  if (calls.length > 0 && calls.every((call) => call.billingTier === "free")) return "free tier";
  return `≈${formatUsd(calls.reduce((sum, call) => sum + (call.estimatedCostUsd ?? 0), 0))}`;
}

/** "gemini-3.5-flash-lite: 1 call, 3.1 s, free tier" for each model used, joined with "; ". */
export function summarizeCalls(calls: CallSummaryInput[]): string {
  const byModel = new Map<string, CallSummaryInput[]>();
  for (const call of calls) {
    const model = call.servedBy ?? call.model;
    byModel.set(model, [...(byModel.get(model) ?? []), call]);
  }
  return [...byModel.entries()]
    .map(([model, group]) => {
      const seconds = group.reduce((sum, call) => sum + call.durationMs, 0) / 1000;
      return `${model}: ${group.length} call${group.length === 1 ? "" : "s"}, ${seconds.toFixed(1)} s, ${formatCost(group)}`;
    })
    .join("; ");
}
