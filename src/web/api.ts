import type { Answer, Usage, VerifiedAnalysis } from "../server/schema";

export type { Answer, Usage, VerifiedAnalysis, VerifiedClause, Citation } from "../server/schema";

export type DocumentView = {
  id: string;
  title: string;
  text: string;
  analysis: VerifiedAnalysis | null;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function uploadFile(file: File): Promise<DocumentView> {
  const form = new FormData();
  form.append("file", file);
  return request("/api/documents", { method: "POST", body: form });
}

export function uploadText(title: string, text: string): Promise<DocumentView> {
  return request("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, text }),
  });
}

export function analyze(id: string): Promise<{ analysis: VerifiedAnalysis; usage: Usage | null; cached: boolean }> {
  return request(`/api/documents/${id}/analyze`, { method: "POST" });
}

export function ask(id: string, question: string): Promise<Answer & { usage: Usage }> {
  return request(`/api/documents/${id}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
}
