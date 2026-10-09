import { LLM } from "./config";

/** Preferred local models, largest first (PRD §14A). The first installed one is used; stepDownModel() moves to a lighter one. */
export const MODEL_PREFERENCE = ["qwen3:4b", "qwen3:1.7b", "qwen2.5:3b"] as const;
export let OLLAMA_BASE = "/ollama";

let installed: string[] = [];
let current: string | null = null;
let latencyMs: number | null = null;
let lightweight = false;

type ModelListener = (model: string | null, lightweight: boolean) => void;
const listeners = new Set<ModelListener>();
const notify = () => listeners.forEach((l) => l(current, lightweight));

/** Point the client at a different Ollama server (tests and scripts use http://127.0.0.1:11434). */
export function setOllamaBase(url: string) {
  OLLAMA_BASE = url.replace(/\/+$/, "");
}

/** The model chatJSON/warmUp will use, or null if checkOllama found none of MODEL_PREFERENCE installed (or was not run). */
export function currentModel(): string | null {
  return current;
}

/** Wall time in ms of the last completed chatJSON call, or null if none yet. */
export function lastLatencyMs(): number | null {
  return latencyMs;
}

/** True once this Session stepped down to a lighter model (§14A.5). Reset only by checkOllama(). */
export function isLightweight(): boolean {
  return lightweight;
}

/** Subscribe to model changes (step-down or checkOllama). Returns an unsubscribe function. */
export function onModelChange(listener: ModelListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Lightweight mode (§14A.5): switch to the next smaller installed model in MODEL_PREFERENCE.
 * Returns the new model, or null (current unchanged) if there is no smaller installed model.
 */
export function stepDownModel(): string | null {
  const from = current === null ? -1 : MODEL_PREFERENCE.indexOf(current as (typeof MODEL_PREFERENCE)[number]);
  const next = MODEL_PREFERENCE.slice(from + 1).find((m) => installed.includes(m));
  if (!next) return null;
  current = next;
  lightweight = true;
  notify();
  return next;
}

/**
 * True only if Ollama answers and at least one MODEL_PREFERENCE model is pulled; selects the first one
 * and clears lightweight mode (call it at Session start). Never throws.
 */
export async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
    const names = new Set((data.models ?? []).flatMap((m) => [m.name, m.model]).filter((x): x is string => !!x));
    installed = MODEL_PREFERENCE.filter((m) => names.has(m));
    current = installed[0] ?? null;
    lightweight = false;
    latencyMs = null;
    notify();
    return current !== null;
  } catch {
    return false;
  }
}

/** Model to send: the selected one, else the smallest preference (what the demo laptop has). */
const modelToUse = () => current ?? MODEL_PREFERENCE[MODEL_PREFERENCE.length - 1];
/** Qwen3 thinks by default; disable it so answers come back fast and as plain JSON. */
const thinkField = (model: string) => (model.startsWith("qwen3") ? { think: false } : {});

/** Single flight (§14A.4): every request waits for the previous one to settle. */
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}

/** Load the model into memory and keep it there, so the first suggestion is fast. Never throws. */
export function warmUp(): Promise<void> {
  return enqueue(async () => {
    const model = modelToUse();
    try {
      await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(LLM.timeoutMs * 3),
        body: JSON.stringify({
          model,
          stream: false,
          keep_alive: LLM.keepAlive,
          ...thinkField(model),
          options: { num_predict: 1 },
          messages: [{ role: "user", content: "ok" }],
        }),
      });
    } catch {
      // Unavailability is reported by checkOllama.
    }
  });
}

export interface ChatOptions {
  /** Overrides LLM.timeoutMs (the post-Session report uses LLM.reportTimeoutMs). */
  timeoutMs?: number;
  /** False for calls whose latency must not trigger lightweight mode (the report). Default true. */
  stepDown?: boolean;
  /** Ollama num_predict cap. */
  maxTokens?: number;
}

/**
 * One non-streaming chat call constrained to a JSON schema; returns the parsed object.
 * Runs one at a time, aborts after LLM.timeoutMs, and steps down to a lighter model when slow.
 * Throws on HTTP/JSON failure, timeout or abort.
 */
export function chatJSON<T>(system: string, user: string, schema: object, signal?: AbortSignal, opts: ChatOptions = {}): Promise<T> {
  return enqueue(async () => {
    signal?.throwIfAborted();
    const model = modelToUse();
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? LLM.timeoutMs);
    const t0 = performance.now();
    const finish = (timedOut: boolean) => {
      latencyMs = Math.round(performance.now() - t0);
      if (opts.stepDown !== false && (timedOut || latencyMs > LLM.slowMs) && current === model) stepDownModel();
    };
    let res: Response;
    try {
      res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        body: JSON.stringify({
          model,
          stream: false,
          format: schema,
          ...thinkField(model),
          options: { temperature: 0, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) },
          keep_alive: LLM.keepAlive,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } catch (e) {
      if (timeout.aborted) finish(true);
      throw e;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    let data: { message?: { content?: string } };
    try {
      data = (await res.json()) as { message?: { content?: string } };
    } catch (e) {
      if (timeout.aborted) finish(true);
      throw e;
    }
    finish(false);
    const content = data.message?.content ?? "";
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new Error(`Ollama returned invalid JSON: ${content.slice(0, 200)}`);
    }
  });
}
