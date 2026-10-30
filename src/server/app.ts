import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import path from "node:path";
import { toHttpError, type Analyzer } from "./analyzer";
import { logUsage } from "./pricing";
import { verifyClauses } from "./quotes";
import type { DocumentStore } from "./store";
import { cleanText, MAX_CHARS, pdfToText } from "./text";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

type Deps = { analyzer: Analyzer; store: DocumentStore; staticDir?: string };

export function createApp({ analyzer, store, staticDir }: Deps) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Upload a PDF or .txt file (multipart field "file"), or JSON { title, text }
  app.post("/api/documents", upload.single("file"), async (req, res, next) => {
    try {
      let title: string;
      let text: string;

      if (req.file) {
        title = req.file.originalname;
        const isPdf = req.file.mimetype === "application/pdf" || title.toLowerCase().endsWith(".pdf");
        text = isPdf ? await pdfToText(req.file.buffer) : req.file.buffer.toString("utf8");
      } else {
        title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "Pasted document";
        text = typeof req.body?.text === "string" ? req.body.text : "";
      }

      text = cleanText(text);
      if (text.length < 50) {
        res.status(400).json({ error: "The document has no readable text. Scanned PDFs need OCR first." });
        return;
      }
      if (text.length > MAX_CHARS) {
        res.status(413).json({ error: `The document is too long (${text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}).` });
        return;
      }

      const doc = await store.create(title, text);
      res.status(201).json({ id: doc.id, title: doc.title, text: doc.text, analysis: null });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/documents/:id", async (req, res, next) => {
    try {
      const doc = await store.get(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "Document not found." });
        return;
      }
      res.json({ id: doc.id, title: doc.title, text: doc.text, analysis: doc.analysis });
    } catch (error) {
      next(error);
    }
  });

  // Results are cached on the document; pass ?refresh=1 to re-run
  app.post("/api/documents/:id/analyze", async (req, res, next) => {
    try {
      const doc = await store.get(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "Document not found." });
        return;
      }
      if (doc.analysis && req.query.refresh !== "1") {
        res.json({ analysis: doc.analysis, usage: doc.analysisUsage, cached: true });
        return;
      }

      const { analysis, usage } = await analyzer.analyze(doc.text);
      logUsage("analyze", doc.id, usage);

      doc.analysis = { ...analysis, clauses: verifyClauses(doc.text, analysis.clauses) };
      doc.analysisUsage = usage;
      await store.save(doc);
      res.json({ analysis: doc.analysis, usage, cached: false });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/documents/:id/ask", async (req, res, next) => {
    try {
      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      if (!question || question.length > 1000) {
        res.status(400).json({ error: "Ask a question of 1 to 1,000 characters." });
        return;
      }
      const doc = await store.get(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "Document not found." });
        return;
      }

      const { answer, usage } = await analyzer.ask(doc.text, doc.title, question);
      logUsage("ask", doc.id, usage);
      res.json({ ...answer, usage });
    } catch (error) {
      next(error);
    }
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const httpError = toHttpError(error);
    if (httpError.status >= 500) console.error(error);
    res.status(httpError.status).json({ error: httpError.message });
  });

  return app;
}
