import { extractText, getDocumentProxy } from "unpdf";

// ~100k tokens. Longer documents are rejected rather than silently truncated.
export const MAX_CHARS = 400_000;

export async function pdfToText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Tidies extracted text: normalizes line endings and drops runs of blank lines. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
