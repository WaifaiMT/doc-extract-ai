import type { Clause, VerifiedClause } from "./schema";

// Characters the model (or the PDF extractor) often swaps for plain ASCII
const EQUIVALENTS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "–": "-", "—": "-", "−": "-",
  " ": " ",
};

/**
 * Normalizes text for quote matching (unified quotes and dashes, collapsed
 * whitespace, lowercase) and keeps a map from each normalized character back
 * to its index in the original string, so a match can be highlighted.
 */
export function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = true; // trims leading whitespace

  for (let i = 0; i < text.length; i++) {
    let ch = EQUIVALENTS[text[i]] ?? text[i];
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      ch = " ";
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    normalized += ch.toLowerCase();
    map.push(i);
  }

  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { normalized, map };
}

/** Finds `quote` in `text`, tolerating whitespace, case, and quote-style differences. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const needle = normalizeWithMap(quote).normalized;
  if (!needle) return null;

  const { normalized, map } = normalizeWithMap(text);
  const at = normalized.indexOf(needle);
  if (at === -1) return null;

  return { start: map[at], end: map[at + needle.length - 1] + 1 };
}

/** Marks each clause with whether its source quote really appears in the document. */
export function verifyClauses(text: string, clauses: Clause[]): VerifiedClause[] {
  return clauses.map((clause) => {
    const range = findQuote(text, clause.source_quote);
    return { ...clause, quote_verified: range !== null, quote_range: range };
  });
}
