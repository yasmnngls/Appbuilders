#!/usr/bin/env node
// M11.1 — local LLM benchmark (PRD §14A.6, BUILD_PLAN M11).
// For each installed model in MODEL_PREFERENCE: cold load time, then N calls per fixed §28 Moment
// using the real CONTRACT_SYSTEM / contractUserMessage / checkQuality from src/llm (loaded through Vite's
// SSR module loader, so the TS sources run as-is). Prints a Markdown table on stdout.
//
//   npm run bench:llm                 # 5 calls per Moment
//   node scripts/bench-llm.mjs 3      # 3 calls per Moment
//   OLLAMA_URL=http://host:11434 npm run bench:llm

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const OLLAMA = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const CALLS = Number(process.argv[2] ?? 5);
const root = fileURLToPath(new URL("..", import.meta.url));

const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true, hmr: false }, appType: "custom" });
let ollamaMod, contract, guard, config, types;
try {
  ollamaMod = await vite.ssrLoadModule("/src/llm/ollama.ts");
  contract = await vite.ssrLoadModule("/src/llm/contract.ts");
  guard = await vite.ssrLoadModule("/src/llm/guard.ts");
  config = await vite.ssrLoadModule("/src/llm/config.ts");
  types = await vite.ssrLoadModule("/src/domain/types.ts");
} finally {
  await vite.close();
}
const { MODEL_PREFERENCE } = ollamaMod;
const { CONTRACT_SYSTEM, CONTRACT_SCHEMA, contractUserMessage } = contract;
const { checkQuality, findBanned } = guard;
const { LLM } = config;
const { MAX_FOLLOW_UPS } = types;

/** Three fixed Moments, shaped exactly like buildContractInput output (§28). */
const MOMENTS = [
  {
    name: "reading",
    qNum: 2,
    input: {
      question: "Tell me about a project you led",
      recent_flags: [
        { type: "reading_pattern", timestamp: "03:12", description: "Reading-like gaze pattern for 9 s (6 left-to-right sweeps)" },
        { type: "off_screen", timestamp: "03:05", description: "Gaze outside the usual range for 4 s" },
      ],
      follow_up_count: 0,
      max_follow_ups: MAX_FOLLOW_UPS,
      gate_reason: "Reading-like gaze pattern held for 9 s during the answer",
      final: false,
    },
  },
  {
    name: "off-screen",
    qNum: 3,
    input: {
      question: "How do you debug a production outage",
      recent_flags: [
        { type: "off_screen", timestamp: "07:40", description: "Gaze outside the usual range for 6 s, to the right" },
        { type: "off_screen", timestamp: "07:21", description: "Gaze outside the usual range for 3 s, to the right" },
      ],
      follow_up_count: 0,
      max_follow_ups: MAX_FOLLOW_UPS,
      gate_reason: "Repeated off-screen gaze in the same direction within 60 s",
      final: false,
    },
  },
  {
    name: "second face",
    qNum: 4,
    input: {
      question: "Describe a disagreement with a teammate",
      recent_flags: [{ type: "second_face", timestamp: "11:02", description: "A second face was visible for 3 s" }],
      follow_up_count: 1,
      max_follow_ups: MAX_FOLLOW_UPS,
      gate_reason: "A second face was visible",
      final: true,
    },
  },
];

const thinkField = (model) => (model.startsWith("qwen3") ? { think: false } : {});

async function json(path, body) {
  const res = await fetch(`${OLLAMA}${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
const gb = (bytes) => (bytes / 1024 ** 3).toFixed(2);

let tags;
try {
  tags = await json("/api/tags");
} catch (e) {
  console.error(`Ollama not reachable at ${OLLAMA}: ${e.message}`);
  process.exit(1);
}
const names = new Set((tags.models ?? []).flatMap((m) => [m.name, m.model]));
const models = MODEL_PREFERENCE.filter((m) => names.has(m));
if (!models.length) {
  console.error(`None of ${MODEL_PREFERENCE.join(", ")} installed. Run: ollama pull qwen2.5:3b`);
  process.exit(1);
}

const rows = [];
for (const model of models) {
  console.error(`\n== ${model}`);
  // Unload first so the next call is a true cold load.
  await json("/api/generate", { model, keep_alive: 0 }).catch(() => {});
  for (let i = 0; i < 50; i++) {
    const ps = await json("/api/ps");
    if (!(ps.models ?? []).some((m) => m.name === model || m.model === model)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const t0 = performance.now();
  const warm = await json("/api/chat", {
    model, stream: false, keep_alive: LLM.keepAlive, ...thinkField(model),
    options: { num_predict: 1 }, messages: [{ role: "user", content: "ok" }],
  });
  const coldMs = Math.round(performance.now() - t0);
  const loadMs = Math.round((warm.load_duration ?? 0) / 1e6);
  console.error(`cold load: ${coldMs} ms wall (Ollama load_duration ${loadMs} ms)`);

  const ps = await json("/api/ps");
  const entry = (ps.models ?? []).find((m) => m.name === model || m.model === model);
  let psLine = "";
  try {
    psLine = execSync("ollama ps", { encoding: "utf8" }).split("\n").find((l) => l.startsWith(model))?.trim().replace(/\s{2,}/g, " · ") ?? "";
  } catch { /* CLI not on PATH; /api/ps is enough */ }

  const lat = [];
  const tps = [];
  let pass = 0, specific = 0, grounded = 0, banned = 0, total = 0;
  const perMoment = [];
  for (const m of MOMENTS) {
    const ml = [];
    let mp = 0;
    for (let i = 0; i < CALLS; i++) {
      const t = performance.now();
      let out = null;
      try {
        const data = await json("/api/chat", {
          model, stream: false, format: CONTRACT_SCHEMA, ...thinkField(model),
          options: { temperature: 0, num_predict: LLM.suggestionMaxTokens }, keep_alive: LLM.keepAlive,
          messages: [{ role: "system", content: CONTRACT_SYSTEM }, { role: "user", content: contractUserMessage(m.input, m.qNum) }],
        });
        out = JSON.parse(data.message?.content ?? "");
        if (data.eval_count && data.eval_duration) tps.push(data.eval_count / (data.eval_duration / 1e9));
      } catch (e) {
        console.error(`  ${m.name} #${i + 1}: error ${e.message}`);
      }
      const ms = Math.round(performance.now() - t);
      lat.push(ms); ml.push(ms); total++;
      if (!out) continue;
      const q = checkQuality(out, m.input);
      const note = String(out.interviewer_note ?? "").trim(), fu = String(out.follow_up ?? "").trim();
      const ok = q.neutral && !!note && !!fu; // M5.3 pass rule, same as writeSuggestion
      if (findBanned(`${note} ${fu}`).length) banned++;
      if (ok) { pass++; mp++; }
      if (q.specific) specific++;
      if (q.grounded) grounded++;
      console.error(`  ${m.name} #${i + 1}: ${ms} ms ${ok ? "PASS" : "FAIL"} | ${fu}`);
    }
    ml.sort((a, b) => a - b);
    perMoment.push({ name: m.name, p50: pct(ml, 50), pass: `${mp}/${CALLS}` });
  }
  lat.sort((a, b) => a - b);
  rows.push({
    model, coldMs, loadMs,
    tps: tps.length ? (tps.reduce((a, b) => a + b, 0) / tps.length).toFixed(1) : "n/a",
    p50: pct(lat, 50), p95: pct(lat, 95), max: lat[lat.length - 1],
    pass: `${pass}/${total} (${Math.round((100 * pass) / total)}%)`,
    specific: `${specific}/${total}`, grounded: `${grounded}/${total}`, banned,
    mem: entry ? `${gb(entry.size)} GB total, ${gb(entry.size_vram ?? 0)} GB VRAM` : "n/a",
    psLine, perMoment,
  });
}

console.log(`\n### Local LLM benchmark (${new Date().toLocaleDateString("en-CA")}, ${CALLS} calls × ${MOMENTS.length} Moments per model)\n`);
console.log("| Model | Cold load (wall) | Ollama load_duration | p50 | p95 | max | Gen tok/s (mean) | Guard pass (neutral + non-empty) | Specific | Grounded | Banned-word hits | Memory (`/api/ps`) |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.model} | ${r.coldMs} ms | ${r.loadMs} ms | ${r.p50} ms | ${r.p95} ms | ${r.max} ms | ${r.tps} | ${r.pass} | ${r.specific} | ${r.grounded} | ${r.banned} | ${r.mem} |`);
}
console.log("\n| Model | Moment | p50 | Guard pass |\n|---|---|---|---|");
for (const r of rows) for (const m of r.perMoment) console.log(`| ${r.model} | ${m.name} | ${m.p50} ms | ${m.pass} |`);
console.log("\n`ollama ps` after load:\n");
for (const r of rows) if (r.psLine) console.log(`- ${r.psLine}`);
