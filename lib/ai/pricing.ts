// Estimated cost of a model call, from its token usage. List prices in USD per million
// tokens as of October 2026; check the Anthropic pricing page before budgeting on them.
// Thinking tokens are billed as output and are included in output_tokens.

interface RateCard {
  input: number;
  output: number;
  /** Multiples of the input rate. */
  cacheReadFactor: number;
  cacheWriteFactor: number;
}

const PRICES: Record<string, { base: RateCard; longPrompt?: { aboveTokens: number; card: RateCard } }> = {
  "claude-opus-5-5": { base: { input: 4, output: 20, cacheReadFactor: 0.05, cacheWriteFactor: 1.25 } },
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 } },
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 },
    // Haiku 5.5 has a second rate card for prompts over 100K tokens.
    longPrompt: { aboveTokens: 100_000, card: { input: 0.5, output: 2.5, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 } },
  },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** USD, or null for a model without a price entry here. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const prices = PRICES[model];
  if (!prices) return null;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const card = prices.longPrompt && promptTokens > prices.longPrompt.aboveTokens ? prices.longPrompt.card : prices.base;
  const usd =
    usage.inputTokens * card.input +
    usage.cacheReadTokens * card.input * card.cacheReadFactor +
    usage.cacheWriteTokens * card.input * card.cacheWriteFactor +
    usage.outputTokens * card.output;
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
  estimatedCostUsd: number | null;
}

/** "claude-haiku-5-5: 1 call, 3.1 s, ≈$0.0021" for each model used, joined with "; ". */
export function summarizeCalls(calls: CallSummaryInput[]): string {
  const byModel = new Map<string, CallSummaryInput[]>();
  for (const call of calls) {
    const model = call.servedBy ?? call.model;
    byModel.set(model, [...(byModel.get(model) ?? []), call]);
  }
  return [...byModel.entries()]
    .map(([model, group]) => {
      const seconds = group.reduce((sum, call) => sum + call.durationMs, 0) / 1000;
      const cost = group.reduce((sum, call) => sum + (call.estimatedCostUsd ?? 0), 0);
      return `${model}: ${group.length} call${group.length === 1 ? "" : "s"}, ${seconds.toFixed(1)} s, ≈${formatUsd(cost)}`;
    })
    .join("; ");
}
