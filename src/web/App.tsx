import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Answer, DocumentView, Usage, VerifiedClause } from "./api";

type Range = { start: number; end: number };

const RISK_STYLES: Record<VerifiedClause["risk"], string> = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-rose-100 text-rose-800",
};

function formatCost(usage: Usage | null | undefined): string {
  if (!usage) return "";
  return `${(usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens).toLocaleString()} in / ${usage.output_tokens.toLocaleString()} out · $${usage.cost_usd.toFixed(4)}`;
}

export function App() {
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [highlight, setHighlight] = useState<Range | null>(null);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Doc Extract AI</h1>
          <p className="text-sm text-slate-500">Extract key clauses from a contract, then ask questions answered only from the document.</p>
        </div>
        {doc && (
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-white"
            onClick={() => {
              setDoc(null);
              setHighlight(null);
            }}
          >
            New document
          </button>
        )}
      </header>

      <p className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        AI-generated analysis. Verify it against the document before relying on it. This is not legal advice.
      </p>

      {doc ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <DocumentPane doc={doc} highlight={highlight} />
          <div className="space-y-6">
            <AnalysisPanel doc={doc} onUpdate={setDoc} onHighlight={setHighlight} />
            <AskPanel docId={doc.id} onHighlight={setHighlight} />
          </div>
        </div>
      ) : (
        <UploadPanel onUploaded={setDoc} />
      )}
    </div>
  );
}

function UploadPanel({ onUploaded }: { onUploaded: (doc: DocumentView) => void }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<DocumentView>) {
    setBusy(true);
    setError(null);
    try {
      onUploaded(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-10 text-center hover:border-slate-400">
        <span className="text-lg font-medium">Upload a PDF or .txt file</span>
        <span className="mt-1 text-sm text-slate-500">Text-based PDFs only (scanned PDFs need OCR first)</span>
        <input
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) run(() => api.uploadFile(file));
          }}
        />
      </label>

      <form
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api.uploadText(title, text));
        }}
      >
        <input
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="min-h-48 flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
          placeholder="…or paste the contract text here"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || text.trim().length < 50}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Uploading…" : "Use this text"}
        </button>
      </form>

      {error && <p className="text-sm text-rose-700 md:col-span-2">{error}</p>}
    </div>
  );
}

function DocumentPane({ doc, highlight }: { doc: DocumentView; highlight: Range | null }) {
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    markRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  const { text } = doc;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">{doc.title}</h2>
      <div className="max-h-[75vh] overflow-y-auto whitespace-pre-wrap px-4 py-3 font-serif text-[15px] leading-relaxed">
        {highlight ? (
          <>
            {text.slice(0, highlight.start)}
            <mark ref={markRef} className="rounded bg-yellow-200 px-0.5">
              {text.slice(highlight.start, highlight.end)}
            </mark>
            {text.slice(highlight.end)}
          </>
        ) : (
          text
        )}
      </div>
    </section>
  );
}

function AnalysisPanel({
  doc,
  onUpdate,
  onHighlight,
}: {
  doc: DocumentView;
  onUpdate: (doc: DocumentView) => void;
  onHighlight: (range: Range) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const analysis = doc.analysis;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.analyze(doc.id);
      setUsage(result.usage);
      onUpdate({ ...doc, analysis: result.analysis });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!analysis) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <button
          onClick={run}
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Analyzing… (this can take a minute)" : "Analyze with AI"}
        </button>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      </section>
    );
  }

  const unverified = analysis.clauses.filter((c) => !c.quote_verified).length;
  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{analysis.document_type}</p>
        <p className="mt-1 text-sm">{analysis.summary}</p>
        {analysis.parties.length > 0 && (
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-medium">Parties:</span>{" "}
            {analysis.parties.map((p) => `${p.name} (${p.role})`).join(" · ")}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {analysis.clauses.length} clauses ·{" "}
          {unverified === 0 ? "all quotes verified against the text" : `${unverified} quote(s) not found in the text`}
          {usage && ` · ${formatCost(usage)}`}
        </p>
      </div>

      {analysis.clauses.map((clause, i) => (
        <ClauseCard key={i} clause={clause} onHighlight={onHighlight} />
      ))}
    </section>
  );
}

function ClauseCard({ clause, onHighlight }: { clause: VerifiedClause; onHighlight: (range: Range) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{clause.type.replace(/_/g, " ")}</p>
          <h3 className="font-semibold">{clause.title}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${RISK_STYLES[clause.risk]}`}>
          {clause.risk} risk
        </span>
      </div>
      <p className="mt-2 text-sm">{clause.summary}</p>

      {clause.dates.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
          {clause.dates.map((d, i) => (
            <li key={i}>
              <span className="font-medium">{d.description}:</span> {d.value ?? "not stated"}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button className="text-indigo-700 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide details" : "Details & source"}
        </button>
        {clause.quote_range ? (
          <button className="text-emerald-700 hover:underline" onClick={() => onHighlight(clause.quote_range!)}>
            ✓ Show in document
          </button>
        ) : (
          <span className="text-rose-700" title="The quoted text wasn't found in the document. Treat this clause with caution.">
            ⚠ Quote not found in document
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
          <p className="text-slate-600">
            <span className="font-medium">Why this risk level:</span> {clause.risk_reason}
          </p>
          {clause.obligations.length > 0 && (
            <ul className="list-disc pl-5 text-slate-600">
              {clause.obligations.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          )}
          <blockquote className="border-l-4 border-slate-300 pl-3 font-serif italic text-slate-700">
            “{clause.source_quote}”
          </blockquote>
        </div>
      )}
    </article>
  );
}

function AskPanel({ docId, onHighlight }: { docId: string; onHighlight: (range: Range) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(Answer & { usage: Usage }) | null>(null);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Ask about this document</h2>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setResult(await api.ask(docId, question));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="e.g. What's the notice period for termination?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3">
          <p className={`text-sm ${result.found ? "" : "italic text-slate-500"}`}>{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</p>
              {result.citations.map((c, i) => (
                <button
                  key={i}
                  onClick={() => onHighlight({ start: c.start, end: c.end })}
                  className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left font-serif text-sm italic text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                >
                  “{c.cited_text.trim()}”
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400">{formatCost(result.usage)}</p>
        </div>
      )}
    </section>
  );
}
