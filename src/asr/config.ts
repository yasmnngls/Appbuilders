/** Local speech recognition settings (whisper.cpp server on 127.0.0.1:8178, reached via the same-origin /whisper proxy). */
export const WHISPER_BASE = "/whisper";
/** Model the server is started with (npm run whisper). Chosen from docs/BENCHMARK.md. */
export const WHISPER_MODEL = "tiny.en";
/** Hard cap for one transcription request. */
export const WHISPER_TIMEOUT_MS = 8000;
/** Cap for the availability probe. */
export const WHISPER_STATUS_TIMEOUT_MS = 1500;
export const WHISPER_SAMPLE_RATE = 16000;
