export const MODEL = "qwen2.5:3b";
export let OLLAMA_BASE = "/ollama";

/** Point the client at a different Ollama server (tests and scripts use http://127.0.0.1:11434). */
export function setOllamaBase(url: string) {
  OLLAMA_BASE = url.replace(/\/+$/, "");
}

/** True only if Ollama answers and MODEL is pulled. Never throws. */
export async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: { name: string; model?: string }[] };
    return (data.models ?? []).some((m) => m.name === MODEL || m.model === MODEL);
  } catch {
    return false;
  }
}

/** Load the model into memory and keep it there, so the first Interviewer Note is fast. */
export async function warmUp(): Promise<void> {
  try {
    await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: "30m",
        options: { num_predict: 1 },
        messages: [{ role: "user", content: "ok" }],
      }),
    });
  } catch {
    // Unavailability is reported by checkOllama.
  }
}

/** One non-streaming chat call constrained to a JSON schema; returns the parsed object. */
export async function chatJSON<T>(system: string, user: string, schema: object, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: schema,
      options: { temperature: 0 },
      keep_alive: "30m",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content ?? "";
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Ollama returned invalid JSON: ${content.slice(0, 200)}`);
  }
}
