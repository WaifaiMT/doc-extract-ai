// Runs the analyzer against the sample contracts and scores it.
// Costs real API money (roughly $0.05-0.15 per contract). Usage: npm run eval
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeAnalyzer, MODEL } from "../src/server/analyzer";
import { verifyClauses } from "../src/server/quotes";

type Case = {
  file: string;
  parties: string[];
  clause_types: string[];
  high_risk_types: string[];
  questions: { q: string; expect?: "NOT_FOUND"; expect_any?: string[] }[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const cases: Case[] = JSON.parse(await readFile(path.join(here, "cases.json"), "utf8"));
const analyzer = new ClaudeAnalyzer();

const includes = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

let totalCost = 0;
const totals = { parties: [0, 0], types: [0, 0], risk: [0, 0], quotes: [0, 0], answers: [0, 0], notFound: [0, 0] };
const report: unknown[] = [];

for (const c of cases) {
  const text = await readFile(path.join(here, "contracts", c.file), "utf8");
  console.log(`\n▶ ${c.file}`);

  const { analysis, usage } = await analyzer.analyze(text);
  totalCost += usage.cost_usd;
  const clauses = verifyClauses(text, analysis.clauses);

  const partyNames = analysis.parties.map((p) => p.name).join(" | ");
  const partiesFound = c.parties.filter((p) => includes(partyNames, p));
  const types = new Set(clauses.map((cl) => cl.type));
  const typesFound = c.clause_types.filter((t) => types.has(t as never));
  const highRisk = new Set(clauses.filter((cl) => cl.risk === "high").map((cl) => cl.type));
  const riskFound = c.high_risk_types.filter((t) => highRisk.has(t as never));
  const verified = clauses.filter((cl) => cl.quote_verified);

  totals.parties[0] += partiesFound.length; totals.parties[1] += c.parties.length;
  totals.types[0] += typesFound.length; totals.types[1] += c.clause_types.length;
  totals.risk[0] += riskFound.length; totals.risk[1] += c.high_risk_types.length;
  totals.quotes[0] += verified.length; totals.quotes[1] += clauses.length;

  console.log(`  parties ${partiesFound.length}/${c.parties.length} · clause types ${typesFound.length}/${c.clause_types.length} · high-risk flags ${riskFound.length}/${c.high_risk_types.length} · quotes verified ${verified.length}/${clauses.length}`);
  for (const cl of clauses.filter((x) => !x.quote_verified)) {
    console.log(`  ⚠ unverified quote (${cl.type}): "${cl.source_quote.slice(0, 80)}…"`);
  }

  const answers = [];
  for (const question of c.questions) {
    const { answer, usage: askUsage } = await analyzer.ask(text, c.file, question.q);
    totalCost += askUsage.cost_usd;

    let pass: boolean;
    if (question.expect === "NOT_FOUND") {
      pass = !answer.found;
      totals.notFound[1] += 1;
      if (pass) totals.notFound[0] += 1;
    } else {
      // Pass if any expected phrase appears in the answer or its citations
      const cited = answer.citations.map((x) => x.cited_text).join(" ");
      pass = answer.found && (question.expect_any ?? []).some((e) => includes(answer.answer, e) || includes(cited, e));
      totals.answers[1] += 1;
      if (pass) totals.answers[0] += 1;
    }
    console.log(`  ${pass ? "✓" : "✗"} ${question.q}  →  ${answer.answer.replace(/\s+/g, " ").slice(0, 100)}`);
    answers.push({ question: question.q, pass, answer });
  }

  report.push({ file: c.file, partiesFound, typesFound, riskFound, clauses, answers, usage });
}

const summary = {
  model: MODEL,
  ran_at: new Date().toISOString(),
  party_recall: pct(totals.parties[0], totals.parties[1]),
  clause_type_recall: pct(totals.types[0], totals.types[1]),
  high_risk_recall: pct(totals.risk[0], totals.risk[1]),
  quotes_verified: pct(totals.quotes[0], totals.quotes[1]),
  answer_accuracy: pct(totals.answers[0], totals.answers[1]),
  not_found_correct: pct(totals.notFound[0], totals.notFound[1]),
  total_cost_usd: Math.round(totalCost * 10000) / 10000,
};

console.log("\n=== Summary ===");
console.table(summary);

const out = path.join(here, "results", `${summary.ran_at.slice(0, 19).replace(/[:T]/g, "-")}.json`);
await writeFile(out, JSON.stringify({ summary, report }, null, 2));
console.log(`Full results: ${path.relative(process.cwd(), out)}`);
