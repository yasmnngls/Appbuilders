// Benchmarks local whisper.cpp (whisper-server over HTTP) on this laptop (npm run bench:whisper).
// For each model: start a fresh server on 127.0.0.1:<port>, measure idle RAM, first-request (cold) latency,
// warm p50 latency per utterance, peak RAM during inference, transcript accuracy (WER), and the
// server's sockets (netstat) while transcribing. Test speech is generated offline with Windows SAPI.
//
// Usage: node scripts/bench-whisper.mjs [--models tiny.en,base.en] [--runs 5] [--threads 4] [--port 8179] [--gpu]
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findServer, modelPath, serverArgs } from "./whisper-server.mjs";

const run = promisify(execFile);
const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? def : process.argv[i + 1];
};
const gpu = process.argv.includes("--gpu");
const models = arg("models", "tiny.en,base.en").split(",");
const runs = Number(arg("runs", 5));
const threads = Number(arg("threads", process.env.WHISPER_THREADS || 4));
const port = Number(arg("port", 8179));
const base = `http://127.0.0.1:${port}`;

const UTTERANCES = [
  { id: "question", rate: 0, text: "Tell me about a difficult project you've worked on." },
  {
    id: "answer",
    rate: -5,
    text: "I worked on a web application with my team. The backend was difficult, but eventually we finished it.",
  },
];

const audioDir = join(tmpdir(), "gazewise-whisper-bench");
mkdirSync(audioDir, { recursive: true });

async function synth(u) {
  const out = join(audioDir, `${u.id}.wav`);
  if (!existsSync(out)) {
    await run("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "scripts", "whisper-tts.ps1"),
      "-Text", u.text, "-Out", out, "-Rate", String(u.rate),
    ]);
  }
  const buf = readFileSync(out);
  const seconds = (buf.length - 44) / 32000; // 16 kHz, 16-bit mono
  return { ...u, path: out, buf, seconds };
}

const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/'/g, "").split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = words(ref), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}

async function workingSetMB(pid) {
  try {
    const { stdout } = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    const m = stdout.match(/"([\d.,\s]+) K"/);
    return m ? Number(m[1].replace(/[^\d]/g, "")) / 1024 : null;
  } catch {
    return null;
  }
}

async function sockets(pid) {
  const { stdout } = await run("netstat", ["-ano"]);
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 4 && c[c.length - 1] === String(pid))
    .map((c) => c.join(" "));
}

async function infer(buf) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/wav" }), "u.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  const t0 = performance.now();
  const res = await fetch(`${base}/inference`, { method: "POST", body: form });
  const body = await res.json();
  const ms = performance.now() - t0;
  if (!res.ok || typeof body.text !== "string") throw new Error(`inference failed: ${JSON.stringify(body)}`);
  return { ms, text: body.text.trim() };
}

const p50 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function benchModel(model, audio) {
  const exe = findServer(gpu ? "cuda" : "cpu");
  const mp = modelPath(model);
  if (!exe || !existsSync(mp)) throw new Error(`missing server or model (${model}); run npm run whisper:setup`);
  const t0 = performance.now();
  const child = spawn(exe, serverArgs({ model: mp, threads, port, gpu }), { stdio: "ignore", windowsHide: true });
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) break;
      } catch {}
      if (i > 300) throw new Error("server did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
    const loadMs = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 500));
    const idleMB = await workingSetMB(child.pid);

    let peakMB = idleMB ?? 0;
    let polling = true;
    const poller = (async () => {
      while (polling) {
        const mb = await workingSetMB(child.pid);
        if (mb && mb > peakMB) peakMB = mb;
      }
    })();

    const results = [];
    let net = null;
    for (const u of audio) {
      const cold = await infer(u.buf); // first request of this utterance on a fresh-ish server
      const warm = [];
      let text = cold.text;
      for (let i = 0; i < runs; i++) {
        const pending = infer(u.buf);
        if (!net) net = await sockets(child.pid);
        const r = await pending;
        warm.push(r.ms);
        text = r.text;
      }
      results.push({ id: u.id, seconds: u.seconds, coldMs: cold.ms, warmMs: warm, p50Ms: p50(warm), text, wer: wer(u.text, text) });
    }
    polling = false;
    await poller;
    return { model, loadMs, idleMB, peakMB, results, net };
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function ollamaPs() {
  try {
    const { stdout } = await run("ollama", ["ps"]);
    const lines = stdout.trim().split(/\r?\n/);
    return lines.length > 1 ? lines.slice(1).join("; ") : "no model loaded";
  } catch {
    return "ollama not available";
  }
}

const audio = [];
for (const u of UTTERANCES) audio.push(await synth(u));
const ollama = await ollamaPs();
console.log(`threads=${threads} gpu=${gpu} runs=${runs} ollama: ${ollama}`);
for (const a of audio) console.log(`audio ${a.id}: ${a.seconds.toFixed(2)} s`);

const all = [];
for (const m of models) {
  const r = await benchModel(m, audio);
  all.push(r);
  console.log(`\n## ${m}  load ${r.loadMs.toFixed(0)} ms  RAM idle ${r.idleMB?.toFixed(0)} MB  peak ${r.peakMB.toFixed(0)} MB`);
  for (const x of r.results) {
    console.log(
      `${x.id} (${x.seconds.toFixed(1)} s): cold ${x.coldMs.toFixed(0)} ms, warm p50 ${x.p50Ms.toFixed(0)} ms ` +
        `[${x.warmMs.map((v) => v.toFixed(0)).join(", ")}], WER ${(x.wer * 100).toFixed(1)}%\n  "${x.text}"`,
    );
  }
  console.log("sockets owned by whisper-server during inference:");
  for (const l of r.net ?? []) console.log("  " + l);
  const external = (r.net ?? []).filter((l) => !/\b127\.0\.0\.1:|\[::1\]:/.test(l.split(" ")[1] ?? ""));
  const outbound = (r.net ?? []).filter((l) => {
    const remote = l.split(" ")[2] ?? "";
    return !/^(127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\*):/.test(remote);
  });
  console.log(`  non-loopback local binds: ${external.length}, non-loopback remote peers: ${outbound.length}`);
}
console.log("\nJSON " + JSON.stringify({ threads, gpu, runs, ollama, all: all.map(({ net, ...x }) => x) }));
