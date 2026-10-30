import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Usage, VerifiedAnalysis } from "./schema";

export type StoredDocument = {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  analysis: VerifiedAnalysis | null;
  analysisUsage: Usage | null;
};

/** Small JSON-file store: one file per document, so analyses survive restarts. */
export class DocumentStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async create(title: string, text: string): Promise<StoredDocument> {
    const doc: StoredDocument = {
      id: randomUUID(),
      title,
      text,
      createdAt: new Date().toISOString(),
      analysis: null,
      analysisUsage: null,
    };
    await this.save(doc);
    return doc;
  }

  async get(id: string): Promise<StoredDocument | null> {
    // Ids are UUIDs we generated; reject anything else so it can't escape the directory
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as StoredDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(doc: StoredDocument): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(doc.id), JSON.stringify(doc, null, 2));
  }
}
