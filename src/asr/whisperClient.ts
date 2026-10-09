/**
 * Local speech recognition client (whisper.cpp `whisper-server` on 127.0.0.1, reached through the /whisper dev-server proxy).
 * Audio goes only to this laptop's whisper-server; nothing is sent to a cloud service, and audio is never stored.
 * Interface is fixed; the implementation is filled in by the Whisper module.
 */
export interface AsrStatus {
  available: boolean;
  model: string | null;
}

/** Checks whether the local whisper-server is reachable. Never throws. */
export async function whisperStatus(_signal?: AbortSignal): Promise<AsrStatus> {
  return { available: false, model: null };
}

/** Transcribes one utterance (16 kHz mono float PCM). Resolves to trimmed text ("" for silence/noise). Throws on failure. */
export async function transcribe(_pcm16k: Float32Array, _signal?: AbortSignal): Promise<string> {
  throw new Error("whisper client not implemented");
}
