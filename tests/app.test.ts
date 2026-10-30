import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyzerError, NOT_FOUND, type Analyzer } from "../src/server/analyzer";
import { createApp } from "../src/server/app";
import type { Analysis, Usage } from "../src/server/schema";
import { DocumentStore } from "../src/server/store";

const CONTRACT = `SERVICES AGREEMENT between Acme Ltd ("Client") and Kofi Mensah ("Contractor").
1. PAYMENT. Client shall pay Contractor GHS 5,000 per month within 14 days of invoice.
2. TERMINATION. Either party may terminate this Agreement with 30 days' written notice.`;

const usage: Usage = {
  model: "claude-opus-5-5",
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cost_usd: 0.0014,
};

const analysis: Analysis = {
  document_type: "Services agreement",
  summary: "A monthly services contract.",
  parties: [{ name: "Acme Ltd", role: "Client" }],
  clauses: [
    {
      type: "termination",
      title: "Termination on notice",
      summary: "Either side can end it with 30 days' notice.",
      parties: ["Acme Ltd", "Kofi Mensah"],
      obligations: ["Give 30 days' written notice"],
      dates: [{ description: "Notice period", value: "30 days" }],
      risk: "low",
      risk_reason: "Mutual and standard.",
      source_quote: "Either party may terminate this Agreement with 30 days' written notice.",
    },
    {
      type: "liability",
      title: "Liability cap",
      summary: "Invented clause that isn't in the text.",
      parties: [],
      obligations: [],
      dates: [],
      risk: "medium",
      risk_reason: "",
      source_quote: "Liability is limited to fees paid in the prior 12 months.",
    },
  ],
};

function fakeAnalyzer(): Analyzer {
  return {
    analyze: vi.fn(async () => ({ analysis, usage })),
    ask: vi.fn(async (_text: string, _title: string, question: string) => ({
      answer: question.includes("notice")
        ? { answer: "30 days' written notice.", found: true, citations: [{ cited_text: "30 days' written notice", start: 10, end: 33 }] }
        : { answer: NOT_FOUND, found: false, citations: [] },
      usage,
    })),
  };
}

let dir: string;
let analyzer: Analyzer;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "doc-extract-"));
  analyzer = fakeAnalyzer();
  app = createApp({ analyzer, store: new DocumentStore(dir) });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function createDoc() {
  const res = await request(app).post("/api/documents").send({ title: "Acme contract", text: CONTRACT });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("documents", () => {
  it("accepts pasted text and a .txt upload", async () => {
    await createDoc();
    const upload = await request(app).post("/api/documents").attach("file", Buffer.from(CONTRACT), "contract.txt");
    expect(upload.status).toBe(201);
    expect(upload.body.title).toBe("contract.txt");
    expect(upload.body.text).toContain("SERVICES AGREEMENT");
  });

  it("rejects documents with no real text", async () => {
    const res = await request(app).post("/api/documents").send({ text: "too short" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    expect((await request(app).get("/api/documents/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await request(app).get("/api/documents/..%2F..%2Fetc")).status).toBe(404);
  });
});

describe("analyze", () => {
  it("verifies each clause's quote against the document", async () => {
    const id = await createDoc();
    const res = await request(app).post(`/api/documents/${id}/analyze`);
    expect(res.status).toBe(200);
    const [termination, invented] = res.body.analysis.clauses;
    expect(termination.quote_verified).toBe(true);
    expect(CONTRACT.slice(termination.quote_range.start, termination.quote_range.end)).toBe(
      termination.source_quote,
    );
    expect(invented.quote_verified).toBe(false);
  });

  it("caches the analysis so the model isn't called again", async () => {
    const id = await createDoc();
    await request(app).post(`/api/documents/${id}/analyze`);
    const second = await request(app).post(`/api/documents/${id}/analyze`);
    expect(second.body.cached).toBe(true);
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);

    await request(app).post(`/api/documents/${id}/analyze?refresh=1`);
    expect(analyzer.analyze).toHaveBeenCalledTimes(2);
  });

  it("turns analyzer errors into clean HTTP errors", async () => {
    vi.mocked(analyzer.analyze).mockRejectedValueOnce(new AnalyzerError("The model declined to process this document.", 422));
    const id = await createDoc();
    const res = await request(app).post(`/api/documents/${id}/analyze`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/declined/);
  });
});

describe("ask", () => {
  it("returns a cited answer, or not-found", async () => {
    const id = await createDoc();
    const found = await request(app).post(`/api/documents/${id}/ask`).send({ question: "What's the notice period?" });
    expect(found.body.found).toBe(true);
    expect(found.body.citations).toHaveLength(1);

    const missing = await request(app).post(`/api/documents/${id}/ask`).send({ question: "Who owns the IP?" });
    expect(missing.body.found).toBe(false);
    expect(missing.body.answer).toBe(NOT_FOUND);
  });

  it("validates the question", async () => {
    const id = await createDoc();
    expect((await request(app).post(`/api/documents/${id}/ask`).send({ question: "" })).status).toBe(400);
    expect((await request(app).post(`/api/documents/${id}/ask`).send({ question: "x".repeat(1001) })).status).toBe(400);
  });
});
