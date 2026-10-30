# Doc Extract AI

Upload a contract and get its key clauses (parties, payment, termination, liability, IP, non-competes, and more), each with a risk rating and a source quote. Then ask questions about the document and get answers backed by citations from it.

Built with the Claude API, TypeScript, Express, and React.

> AI-generated analysis can be wrong. Verify it against the document before relying on it. This is not legal advice.

## Why it's built this way

The hard part of LLM document analysis isn't calling the API. It's making sure the output can be trusted. Three design choices handle that:

1. **Structured outputs, validated with Zod.** Extraction uses the Messages API's structured outputs (`output_config.format`) with a Zod schema, so the response is typed JSON, not prose to parse. If parsing still fails, the request is retried once, then fails cleanly.
2. **Every quote is checked against the document.** The model must back each clause with a verbatim `source_quote`. The server then searches the original text for it, tolerating whitespace, case, and curly-quote differences. Clauses whose quote can't be found are flagged in the UI ("⚠ Quote not found"), and verified ones link to the exact passage. This catches hallucinated clauses programmatically instead of trusting the model.
3. **Q&A uses the Citations API.** Questions are answered with the document passed as a `document` block with citations enabled. The answer comes back with character-level citations that highlight the source passage, and if the document doesn't cover the question, the app says "Not found in this document." instead of guessing.

Other details:

- **Prompt caching** on the document for Q&A, so follow-up questions on the same document are cheaper.
- **Token usage and cost are logged** for every call (`{"event":"claude_usage", ...}` JSON lines) and shown in the UI.
- **Server-side refusal fallback** (`fallbacks: "default"`), so a declined request is retried on a fallback model within the same call.
- **Guardrails:** documents over ~100k tokens are rejected rather than silently truncated; the API key stays on the server; errors from the API are mapped to clean HTTP responses without leaking details.
- **Analyses are cached** per document, so viewing results doesn't call the API again.

## Evaluation

`eval/` holds five fictional sample contracts (an NDA, freelance services agreement, commercial lease, SaaS subscription, and employment offer) with known answers in `eval/cases.json`. `npm run eval` runs the full pipeline on each and scores:

| Metric | What it checks |
|---|---|
| Party recall | Were the named parties extracted? |
| Clause-type recall | Were the expected clause types found? |
| High-risk recall | Were the genuinely risky clauses (e.g. an unlimited indemnity, a 24-month non-compete) rated high? |
| Quotes verified | What share of source quotes appear verbatim in the document? |
| Answer accuracy | Do answers to factual questions contain the right value? |
| Not-found handling | For questions the document doesn't answer, does the app say so instead of inventing an answer? |

Results are written to `eval/results/`. A run costs roughly $0.50 to $1 in API usage.

## Tech stack

- **Server:** Node.js, Express 5, TypeScript, Anthropic TypeScript SDK, Zod, unpdf (PDF text extraction), Multer
- **Web:** React 19, Vite, Tailwind CSS v4
- **Testing:** Vitest + Supertest, with a fake analyzer so tests run without an API key
- **CI:** GitHub Actions (typecheck, tests, build)

## Running locally

Requires Node.js 20+ and an [Anthropic API key](https://console.anthropic.com).

```bash
npm install
cp .env.example .env      # then add your ANTHROPIC_API_KEY
npm run dev               # API on :3001, web app on http://localhost:5173
```

Other scripts:

```bash
npm test          # unit and API tests (no API key needed)
npm run typecheck
npm run build     # builds the web app into dist/web
npm start         # serves the API and the built web app on :3001
npm run eval      # runs the evaluation (uses your API key; costs money)
```

## API

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/documents` | Upload a PDF/.txt (`multipart`, field `file`) or JSON `{ title, text }` |
| `GET` | `/api/documents/:id` | Get a document and its cached analysis |
| `POST` | `/api/documents/:id/analyze` | Extract clauses (cached; `?refresh=1` re-runs) |
| `POST` | `/api/documents/:id/ask` | `{ question }` → `{ answer, found, citations[] }` |

## Project structure

```
src/server/
  analyzer.ts   # Claude calls: structured extraction and cited Q&A
  schema.ts     # Zod schema for the analysis, shared types
  quotes.ts     # verifies source quotes against the document text
  pricing.ts    # token usage → cost
  app.ts        # Express routes
  store.ts      # JSON-file document store
  text.ts       # PDF text extraction and cleanup
src/web/        # React UI
tests/          # Vitest + Supertest
eval/           # sample contracts, expected answers, eval runner
```

## Limitations and next steps

- Text-based PDFs only. Scanned documents need OCR first.
- One document at a time. Next step: embed clauses in PostgreSQL with pgvector to search across many documents.
- Responses aren't streamed yet.

## License

MIT
