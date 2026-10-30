import { z } from "zod";

export const ClauseType = z.enum([
  "parties",
  "term",
  "termination",
  "payment",
  "confidentiality",
  "liability",
  "indemnification",
  "intellectual_property",
  "warranty",
  "non_compete",
  "governing_law",
  "dispute_resolution",
  "other",
]);

export const RiskLevel = z.enum(["low", "medium", "high"]);

export const ClauseSchema = z.object({
  type: ClauseType,
  title: z.string().describe("Short heading for the clause, e.g. 'Termination for convenience'"),
  summary: z.string().describe("One or two plain-English sentences on what the clause does"),
  parties: z.array(z.string()).describe("Parties this clause binds or benefits; empty if none named"),
  obligations: z.array(z.string()).describe("Concrete duties the clause creates"),
  dates: z
    .array(
      z.object({
        description: z.string().describe("What the date or deadline is for"),
        value: z
          .string()
          .nullable()
          .describe("The date or period exactly as stated (e.g. '30 days', 'March 1, 2026'), or null"),
      }),
    )
    .describe("Dates, deadlines, and notice periods in this clause"),
  risk: RiskLevel.describe("How much attention a reviewer should give this clause"),
  risk_reason: z.string().describe("Why the clause got this risk level"),
  source_quote: z
    .string()
    .describe("A short passage copied character-for-character from the document that supports this clause"),
});

export const AnalysisSchema = z.object({
  document_type: z.string().describe("e.g. 'Mutual non-disclosure agreement'"),
  summary: z.string().describe("Two or three sentences describing the document"),
  parties: z.array(
    z.object({
      name: z.string(),
      role: z.string().describe("e.g. 'Client', 'Contractor', 'Landlord'"),
    }),
  ),
  clauses: z.array(ClauseSchema),
});

export type Clause = z.infer<typeof ClauseSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

/** A clause after we've checked its source quote against the document text. */
export type VerifiedClause = Clause & {
  quote_verified: boolean;
  /** Character range of the quote in the original document text, when found. */
  quote_range: { start: number; end: number } | null;
};

export type VerifiedAnalysis = Omit<Analysis, "clauses"> & { clauses: VerifiedClause[] };

export type Usage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
};

export type Citation = { cited_text: string; start: number; end: number };

export type Answer = {
  answer: string;
  found: boolean;
  citations: Citation[];
};
