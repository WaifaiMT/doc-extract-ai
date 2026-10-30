import { describe, expect, it } from "vitest";
import { findQuote, verifyClauses } from "../src/server/quotes";
import type { Clause } from "../src/server/schema";

const TEXT = `7. TERMINATION.\nEither party may terminate this Agreement upon thirty (30)   days' written notice.\n\n8. GOVERNING LAW. This Agreement is governed by the laws of Ghana.`;

const clause = (source_quote: string): Clause => ({
  type: "termination",
  title: "Termination",
  summary: "",
  parties: [],
  obligations: [],
  dates: [],
  risk: "low",
  risk_reason: "",
  source_quote,
});

describe("findQuote", () => {
  it("finds an exact quote and returns its range in the original text", () => {
    const quote = "governed by the laws of Ghana";
    const range = findQuote(TEXT, quote);
    expect(range).not.toBeNull();
    expect(TEXT.slice(range!.start, range!.end)).toBe(quote);
  });

  it("tolerates whitespace, line breaks, case, and curly quotes", () => {
    const range = findQuote(TEXT, "either party may terminate this agreement upon thirty (30) days’ written notice");
    expect(range).not.toBeNull();
    expect(TEXT.slice(range!.start, range!.end)).toBe(
      "Either party may terminate this Agreement upon thirty (30)   days' written notice",
    );
  });

  it("returns null for paraphrases and invented text", () => {
    expect(findQuote(TEXT, "Either party can end the agreement with 30 days notice")).toBeNull();
    expect(findQuote(TEXT, "The Contractor shall indemnify the Client")).toBeNull();
    expect(findQuote(TEXT, "   ")).toBeNull();
  });
});

describe("verifyClauses", () => {
  it("flags clauses whose quote isn't in the document", () => {
    const [real, invented] = verifyClauses(TEXT, [
      clause("governed by the laws of Ghana"),
      clause("liability is capped at the fees paid"),
    ]);
    expect(real.quote_verified).toBe(true);
    expect(real.quote_range).not.toBeNull();
    expect(invented.quote_verified).toBe(false);
    expect(invented.quote_range).toBeNull();
  });
});
