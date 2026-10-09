/**
 * Local speech recognition client (whisper.cpp `whisper-server` on 127.0.0.1, reached through the /whisper dev-server proxy).
 * Audio goes only to this laptop's whisper-server; nothing is sent to a cloud service, and audio is never stored.
 */
import {
  WHISPER_BASE,
  WHISPER_MODEL,
  WHISPER_SAMPLE_RATE,
  WHISPER_STATUS_TIMEOUT_MS,
  WHISPER_TIMEOUT_MS,
} from "./config";

export interface AsrStatus {
  available: boolean;
  model: string | null;
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Encodes mono float PCM as a 16-bit PCM WAV (RIFF) file in memory. */
export function encodeWav(pcm: Float32Array, sampleRate = WHISPER_SAMPLE_RATE): ArrayBuffer {
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i];
    const s = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buf;
}

/** Removes whisper's non-speech annotations ("[BLANK_AUDIO]", "(music)", "[ Silence ]", "*laughs*") and tidies whitespace. */
export function stripNonSpeech(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Checks whether the local whisper-server is reachable (GET /health, falling back to GET /). Never throws. */
export async function whisperStatus(signal?: AbortSignal): Promise<AsrStatus> {
  try {
    const s = withTimeout(WHISPER_STATUS_TIMEOUT_MS, signal);
    let res = await fetch(`${WHISPER_BASE}/health`, { signal: s });
    if (res.status === 404) res = await fetch(`${WHISPER_BASE}/`, { signal: s });
    return res.ok ? { available: true, model: WHISPER_MODEL } : { available: false, model: null };
  } catch {
    return { available: false, model: null };
  }
}

/** Transcribes one utterance (16 kHz mono float PCM). Resolves to trimmed text ("" for silence/noise). Throws on failure. */
export async function transcribe(pcm16k: Float32Array, signal?: AbortSignal): Promise<string> {
  if (pcm16k.length === 0) return "";
  const form = new FormData();
  form.append("file", new Blob([encodeWav(pcm16k)], { type: "audio/wav" }), "utterance.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  const res = await fetch(`${WHISPER_BASE}/inference`, {
    method: "POST",
    body: form,
    signal: withTimeout(WHISPER_TIMEOUT_MS, signal),
  });
  if (!res.ok) throw new Error(`whisper-server returned HTTP ${res.status}`);
  const body = (await res.json()) as { text?: unknown; error?: unknown };
  if (typeof body.error === "string") throw new Error(`whisper-server error: ${body.error}`);
  if (typeof body.text !== "string") throw new Error("whisper-server returned no text");
  return stripNonSpeech(body.text);
}
