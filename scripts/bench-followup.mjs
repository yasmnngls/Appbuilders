#!/usr/bin/env node
// Follow-up reasoning live check: runs Cases A–G and the hero demo (src/context/testing/followUpCases.ts)
// through the REAL writeSuggestion — same system prompt, schema, analyzer, guard and templates as the app —
// against a local Ollama. The TS sources are loaded through Vite's SSR module loader, so they run as-is.
// Prints a Markdown table on stdout (pass/fail per case, model verdict, final follow-up, latency).
//
//   npm run bench:followup              # 3 runs per case, qwen2.5:3b at http://127.0.0.1:11434
//   node scripts/bench-followup.mjs 5   # 5 runs per case
//   OLLAMA_URL=http://host:11434 npm run bench:followup

import os from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const OLLAMA = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const RUNS = Number(process.argv[2] ?? 3);
const root = fileURLToPath(new URL("..", import.meta.url));

const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true, hmr: false }, appType: "custom" });
let ollama, moments, cases, gaps, guard, contract, answer;
try {
  ollama = await vite.ssrLoadModule("/src/llm/ollama.ts");
  moments = await vite.ssrLoadModule("/src/llm/moments.ts");
  cases = await vite.ssrLoadModule("/src/context/testing/followUpCases.ts");
  gaps = await vite.ssrLoadModule("/src/context/gaps.ts");
  guard = await vite.ssrLoadModule("/src/llm/guard.ts");
  contract = await vite.ssrLoadModule("/src/llm/contract.ts");
  answer = await vite.ssrLoadModule("/src/context/answer.ts");
} finally {
  await vite.close();
}
const { setOllamaBase, checkOllama, currentModel, warmUp, chatJSON, lastLatencyMs } = ollama;
const { buildContractInput, contractUserMessage, CONTRACT_SYSTEM, CONTRACT_SCHEMA } = contract;
const { contextFor } = answer;
const { checkFollowUp, passesFollowUp } = guard;
const { writeSuggestion } = moments;
const { CASES, caseSession } = cases;
const { gapIdOf, analyzeAnswer } = gaps;
const { findBanned, OBSERVATION_WORDS } = guard;

setOllamaBase(OLLAMA);
if (!(await checkOllama())) {
  console.error(`No preferred model at ${OLLAMA}. Pull qwen2.5:3b (ollama pull qwen2.5:3b).`);
  process.exit(1);
}
const model = currentModel();
const t0 = performance.now();
await warmUp();
const warmMs = Math.round(performance.now() - t0);

const observationRe = new RegExp(`\\b(${OBSERVATION_WORDS.join("|")})\\b`, "i");

/** Does the final suggestion meet the case's expectation? Returns [pass, why]. */
function judge(c, s) {
  const e = c.expect;
  if (e.followUp === "none") return s.followUp === null ? [true, ""] : [false, "a follow-up was suggested"];
  if (s.followUp === null) return [false, "no follow-up"];
  const g = gapIdOf(s.reasoning.gap);
  if (e.gaps && !e.gaps.includes(g)) return [false, `targets ${s.reasoning.gap}`];
  if (e.notGaps?.includes(g)) return [false, `re-targets ${s.reasoning.gap}`];
  if (e.topic && !e.topic.some((w) => s.followUp.toLowerCase().includes(w))) return [false, "topic word missing"];
  if (findBanned(s.followUp).length || observationRe.test(s.followUp)) return [false, "observation/banned wording"];
  if (!analyzeAnswer(c.answer).gaps.some((x) => x.label === s.reasoning.gap)) return [false, "gap not traceable"];
  return [true, ""];
}

/** What the model itself said, before the deterministic wrapper. */
function rawVerdict(c, s) {
  const o = s.modelOutput;
  if (o === undefined) return { text: "not called", right: null };
  if (o === null) return { text: "invalid", right: false };
  const covers = o.answer_covers_question === true;
  const g = gapIdOf(o.gap);
  const text = covers ? "covers" : `gap: ${o.gap ?? "null"}`;
  const right = c.expect.followUp === "none" ? covers : !covers && (!c.expect.gaps || c.expect.gaps.includes(g)) && !(c.expect.notGaps ?? []).includes(g);
  return { text, right };
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

const rows = [];
for (const c of CASES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const { session, moment } = caseSession(c);
    const start = performance.now();
    const s = await writeSuggestion(session, moment);
    const wall = Math.round(performance.now() - start);
    const [pass, why] = judge(c, s);
    runs.push({ s, wall, pass, why, raw: rawVerdict(c, s) });
    process.stderr.write(`${c.id} run ${i + 1}: ${pass ? "PASS" : "FAIL"} ${s.source} ${wall}ms ${JSON.stringify(s.followUp)} raw=${JSON.stringify(s.modelOutput ?? null)}\n`);
  }
  rows.push({ c, runs });
}

const esc = (t) => String(t ?? "—").replace(/\|/g, "\\|");
const lines = [];
lines.push(`Model: \`${model}\` via ${OLLAMA} · ${RUNS} runs per case · warm-up ${warmMs} ms · ${os.cpus()[0]?.model?.trim() ?? "CPU"}, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
lines.push("");
lines.push("| Case | Expected | Pass | Model said (raw) | Model right | Final follow-up (run 1) | Gap | Source | Wall ms (median) | Model call ms (median) |");
lines.push("|---|---|---|---|---|---|---|---|---|---|");
let passTotal = 0;
let runTotal = 0;
for (const { c, runs } of rows) {
  const passes = runs.filter((r) => r.pass).length;
  passTotal += passes;
  runTotal += runs.length;
  const first = runs[0];
  const expected = c.expect.followUp === "none" ? "none" : `${(c.expect.gaps ?? []).join("/")}${c.expect.topic ? ` + "${c.expect.topic[0]}"` : ""}`;
  const rawTexts = [...new Set(runs.map((r) => r.raw.text))].join("; ");
  const rightN = runs.filter((r) => r.raw.right === true).length;
  const called = runs.filter((r) => r.raw.right !== null).length;
  const sources = [...new Set(runs.map((r) => (r.s.followUp === null ? `${r.s.source}, none` : r.s.source)))].join("; ");
  const fails = runs.filter((r) => !r.pass).map((r) => r.why);
  lines.push(
    `| ${c.id} ${esc(c.name)} | ${esc(expected)} | ${passes}/${runs.length}${fails.length ? ` (${esc([...new Set(fails)].join("; "))})` : ""} | ${esc(rawTexts)} | ${called ? `${rightN}/${called}` : "—"} | ${esc(first.s.followUp ?? "(none)")} | ${esc(first.s.reasoning.gap)} | ${esc(sources)} | ${median(runs.map((r) => r.wall))} | ${median(runs.map((r) => (r.raw.right === null ? null : r.s.latencyMs))) ?? "—"} |`,
  );
}
lines.push("");
lines.push(`Total: ${passTotal}/${runTotal} runs met the expectation.`);

// Raw probe: the model alone, without the wrapper's decisions. Every case is sent once, with the analyzer's
// un-asked gaps (empty for a complete answer), to show where the 3B model would be wrong on its own.
lines.push("");
lines.push("Raw model probe (one call per case, no wrapper; the app never sends A/E/G2 to the model):");
lines.push("");
lines.push("| Case | Expected | Model: covers? | Model: gap | Model follow-up | Guard | Model right | ms |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const c of CASES) {
  const { session, moment } = caseSession(c);
  const ctx = contextFor(session, moment.questionId, Number.POSITIVE_INFINITY);
  const open = analyzeAnswer(ctx.answer).gaps.filter((g) => !ctx.askedGaps.includes(g.id));
  const input = buildContractInput(session, moment, { question: ctx.question, answer: ctx.answer, recentExchange: ctx.recentExchange, previousFollowUps: ctx.previousFollowUps, gaps: open });
  let o = null;
  try {
    o = await chatJSON(CONTRACT_SYSTEM, contractUserMessage(input, 2), CONTRACT_SCHEMA, undefined, { maxTokens: 200 });
  } catch (e) {
    o = null;
  }
  const covers = o?.answer_covers_question === true;
  const g = gapIdOf(o?.gap);
  const right = c.expect.followUp === "none" ? covers || !o?.follow_up : !covers && (!c.expect.gaps || c.expect.gaps.includes(g)) && !(c.expect.notGaps ?? []).includes(g);
  const chk = checkFollowUp(o?.follow_up, { question: ctx.question, answer: ctx.answer, previous: ctx.previousFollowUps });
  const guardText = o?.follow_up ? (passesFollowUp(o.follow_up, chk) ? "pass" : `reject: ${chk.problems.join("; ")}`) : "—";
  const expected = c.expect.followUp === "none" ? "none" : (c.expect.gaps ?? []).join("/");
  lines.push(`| ${c.id} | ${esc(expected)} | ${o ? covers : "invalid"} | ${esc(o?.gap ?? "null")} | ${esc(o?.follow_up ?? "(none)")} | ${esc(guardText)} | ${right ? "yes" : "**no**"} | ${lastLatencyMs()} |`);
  process.stderr.write(`probe ${c.id}: ${JSON.stringify(o)}
`);
}
console.log(lines.join("\n"));
