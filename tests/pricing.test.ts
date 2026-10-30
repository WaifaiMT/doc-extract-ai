import { describe, expect, it } from "vitest";
import { toUsage } from "../src/server/pricing";

describe("toUsage", () => {
  it("prices input, cache writes, cache reads, and output separately", () => {
    const usage = toUsage("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    // $4 input + $5 cache write (1.25x) + $0.20 cache read + $2 output
    expect(usage.cost_usd).toBeCloseTo(11.2, 6);
  });

  it("treats missing cache fields as zero", () => {
    const usage = toUsage("claude-opus-5-5", { input_tokens: 500_000, output_tokens: 0 });
    expect(usage.cache_read_input_tokens).toBe(0);
    expect(usage.cost_usd).toBeCloseTo(2, 6);
  });
});
