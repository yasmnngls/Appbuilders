// Starts the local whisper.cpp server for Gazewise (npm run whisper).
// Binds to 127.0.0.1:8178 only. Install binaries/models first: npm run whisper:setup
//
// Env overrides:
//   WHISPER_MODEL   model name (tiny.en | base.en) or a path to a ggml .bin   [default: tiny.en]
//   WHISPER_THREADS CPU threads (i5-13420H: 4 leaves room for the LLM)         [default: 4]
//   WHISPER_PORT    port                                                        [default: 8178]
//   WHISPER_GPU=1   use the CUDA build if installed (setup -Cuda); default CPU build
//   WHISPER_BIN     explicit path to whisper-server.exe
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "tools", "whisper");

export function findServer(flavor = process.env.WHISPER_GPU === "1" ? "cuda" : "cpu") {
  if (process.env.WHISPER_BIN) return process.env.WHISPER_BIN;
  const base = join(root, `bin-${flavor}`);
  if (!existsSync(base)) return null;
  for (const tag of readdirSync(base).sort().reverse()) {
    for (const sub of ["Release", ""]) {
      const exe = join(base, tag, sub, "whisper-server.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

export function modelPath(name = process.env.WHISPER_MODEL || "tiny.en") {
  return name.endsWith(".bin") ? name : join(root, "models", `ggml-${name}.bin`);
}

export function serverArgs({ model, threads, port, gpu }) {
  const args = ["--host", "127.0.0.1", "--port", String(port), "-m", model, "-t", String(threads), "-l", "en", "-nt"];
  if (!gpu) args.push("-ng");
  return args;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const gpu = process.env.WHISPER_GPU === "1";
  const exe = findServer(gpu ? "cuda" : "cpu");
  const model = modelPath();
  if (!exe || !existsSync(exe)) {
    console.error("whisper-server.exe not found. Run: npm run whisper:setup");
    process.exit(1);
  }
  if (!existsSync(model)) {
    console.error(`Model not found: ${model}. Run: npm run whisper:setup`);
    process.exit(1);
  }
  const args = serverArgs({
    model,
    threads: Number(process.env.WHISPER_THREADS) || 4,
    port: Number(process.env.WHISPER_PORT) || 8178,
    gpu,
  });
  console.log(`[whisper] ${exe} ${args.join(" ")}`);
  const child = spawn(exe, args, { stdio: "inherit", windowsHide: true });
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}
