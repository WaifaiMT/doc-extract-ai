import "dotenv/config";
import path from "node:path";
import { ClaudeAnalyzer } from "./analyzer";
import { createApp } from "./app";
import { DocumentStore } from "./store";

const port = Number(process.env.PORT ?? 3001);

// The SDK can also use an `ant auth login` profile, so this is a warning, not an error
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("Warning: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
}
const app = createApp({
  analyzer: new ClaudeAnalyzer(),
  store: new DocumentStore(path.resolve(process.env.DATA_DIR ?? "data/documents")),
  staticDir: path.resolve("dist/web"),
});

app.listen(port, () => {
  console.log(`doc-extract-ai API listening on http://localhost:${port}`);
});
