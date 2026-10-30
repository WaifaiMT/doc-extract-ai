import type { Usage } from "./schema";

// USD per million tokens (Anthropic first-party API rates). Cache writes are
// billed at 1.25x input for the default 5-minute TTL.
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
};

type RawUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function toUsage(model: string, raw: RawUsage): Usage {
  const price = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const cacheWrite = raw.cache_creation_input_tokens ?? 0;
  const cacheRead = raw.cache_read_input_tokens ?? 0;

  const cost =
    (raw.input_tokens * price.input +
      cacheWrite * price.input * 1.25 +
      cacheRead * price.cacheRead +
      raw.output_tokens * price.output) /
    1_000_000;

  return {
    model,
    input_tokens: raw.input_tokens,
    output_tokens: raw.output_tokens,
    cache_creation_input_tokens: cacheWrite,
    cache_read_input_tokens: cacheRead,
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
  };
}

export function logUsage(operation: string, documentId: string, usage: Usage): void {
  console.log(JSON.stringify({ event: "claude_usage", operation, documentId, ...usage }));
}
