import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnalysisSchema, type Analysis, type Answer, type Citation, type Usage } from "./schema";
import { toUsage } from "./pricing";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

// If the model declines a request, the API retries it on a fallback model
// chosen by refusal category, inside the same call.
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

export const NOT_FOUND = "Not found in this document.";

const EXTRACT_SYSTEM = `You are a legal-document analysis assistant.

Extract the key clauses from the document the user provides. Rules:
- Extract only what is actually in the document. Never infer clauses that aren't there.
- Every clause needs a source_quote copied character-for-character from the document (a sentence or two, not a paraphrase). The quote is checked programmatically against the text, so don't fix typos or change punctuation.
- If a field has no basis in the document, use an empty list or null rather than guessing.
- Rate risk from the perspective of someone about to sign: "high" for one-sided, unusual, or open-ended terms (unlimited liability, automatic renewal with short cancellation windows, broad non-competes); "low" for standard boilerplate.
- Describe what the document says. Don't give legal advice.`;

const ASK_SYSTEM = `You answer questions about a single legal document.

Answer only from the document. Support every statement with a citation to the passage it comes from. If the document doesn't answer the question, reply with exactly: "${NOT_FOUND}" and nothing else.
Be concise. Describe what the document says; don't give legal advice.`;

export class AnalyzerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface Analyzer {
  analyze(text: string): Promise<{ analysis: Analysis; usage: Usage }>;
  ask(text: string, title: string, question: string): Promise<{ answer: Answer; usage: Usage }>;
}

function checkStop(stopReason: string | null): void {
  if (stopReason === "refusal") {
    throw new AnalyzerError("The model declined to process this document.", 422);
  }
  if (stopReason === "max_tokens") {
    throw new AnalyzerError("The response hit the output limit. Try a shorter document.", 422);
  }
}

export class ClaudeAnalyzer implements Analyzer {
  constructor(private readonly client: Anthropic = new Anthropic({ timeout: 5 * 60 * 1000 })) {}

  async analyze(text: string): Promise<{ analysis: Analysis; usage: Usage }> {
    // Structured outputs constrain the response to the schema; if parsing still
    // fails (e.g. a truncated response), try once more before giving up.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await this.client.beta.messages.parse({
        ...FALLBACK,
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "high", format: betaZodOutputFormat(AnalysisSchema) },
        system: EXTRACT_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `<document>\n${text}\n</document>` },
              { type: "text", text: "Extract the key clauses from this document." },
            ],
          },
        ],
      });

      checkStop(response.stop_reason);
      const usage = toUsage(response.model, response.usage);
      if (response.parsed_output) return { analysis: response.parsed_output, usage };
      if (attempt === 2) throw new AnalyzerError("The model returned an invalid analysis twice.", 502);
    }
    throw new AnalyzerError("unreachable", 500);
  }

  async ask(text: string, title: string, question: string): Promise<{ answer: Answer; usage: Usage }> {
    const response = await this.client.beta.messages.create({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium" },
      system: ASK_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "text", media_type: "text/plain", data: text },
              title,
              citations: { enabled: true },
              // The document is the same for every question, so cache it
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: question },
          ],
        },
      ],
    });

    checkStop(response.stop_reason);

    let answerText = "";
    const citations: Citation[] = [];
    for (const block of response.content) {
      if (block.type !== "text") continue;
      answerText += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "char_location") {
          citations.push({ cited_text: c.cited_text, start: c.start_char_index, end: c.end_char_index });
        }
      }
    }

    answerText = answerText.trim();
    const found = citations.length > 0 && !answerText.startsWith(NOT_FOUND);
    return {
      answer: { answer: found ? answerText : NOT_FOUND, found, citations: found ? citations : [] },
      usage: toUsage(response.model, response.usage),
    };
  }
}

/** Maps SDK errors to HTTP statuses without leaking provider details to the client. */
export function toHttpError(error: unknown): AnalyzerError {
  if (error instanceof AnalyzerError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new AnalyzerError("The AI service is busy. Try again in a minute.", 429);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AnalyzerError("The server's AI credentials are missing or invalid.", 500);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AnalyzerError("The AI service rejected the request.", 400);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AnalyzerError("Couldn't reach the AI service.", 502);
  }
  if (error instanceof Anthropic.APIError) {
    return new AnalyzerError("The AI service returned an error.", 502);
  }
  if (error instanceof Anthropic.AnthropicError) {
    return new AnalyzerError("The AI request failed before it was sent.", 500);
  }
  return new AnalyzerError("Unexpected server error.", 500);
}
