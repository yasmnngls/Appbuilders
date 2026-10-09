# Benchmark — tested laptop

> Derived from PRD-product.md v1.2 — if they disagree, PRD-product.md wins.

Only measured numbers are recorded here (PRD §14A.6, §14A.7, BUILD_PLAN M11.3). Rows that need a browser run are marked pending; nothing is estimated.

## Machine

| | |
|---|---|
| Laptop | ASUS Vivobook K3605VC |
| CPU | 13th Gen Intel Core i5-13420H |
| GPU | NVIDIA GeForce RTX 3050 4GB Laptop GPU (4096 MiB, driver 581.57) |
| System RAM | 7,862 MB (7.7 GB) |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Ollama | 0.40.1 |
| Node | v24.18.0 |
| Installed models from `MODEL_PREFERENCE` | `qwen2.5:3b` only (`qwen3:4b`, `qwen3:1.7b` not installed) |
| Date | 2026-10-10 |

Sources: `systeminfo`, `Win32_Processor`, `nvidia-smi`, `ollama -v`, `ollama list`.

## Local LLM (§14A.6 "Vision + Local LLM", LLM part)

Command: `npm run bench:llm` ([scripts/bench-llm.mjs](../scripts/bench-llm.mjs)).

Method: the model is unloaded (`keep_alive: 0`), then loaded cold with a 1-token call. Then 5 calls for each of three fixed §28 Moments (reading-like pattern on "Tell me about a project you led", off-screen on "How do you debug a production outage", second face on "Describe a disagreement with a teammate", the last with `final: true`). Each call uses the app's real `CONTRACT_SYSTEM`, `CONTRACT_SCHEMA`, `contractUserMessage`, `temperature: 0` and `num_predict: 200`, sent straight to `http://127.0.0.1:11434/api/chat`. Every answer goes through the app's `checkQuality` / `findBanned`. The pass rule matches `writeSuggestion`: neutral, with a non-empty note and follow-up. Latency is wall time per call. p50/p95 use nearest rank over 15 calls, so p95 here equals the slowest call.

| Model | Cold load (wall) | Ollama `load_duration` | p50 | p95 | max | Gen tok/s (mean) | Guard pass | Specific | Grounded | Banned-word hits | Memory (`/api/ps`) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | 11,445 ms | 11,192 ms | 5,912 ms | 12,645 ms | 12,645 ms | 14.5 | 15/15 (100%) | 15/15 | 15/15 | 0 | 2.01 GB, all in VRAM |

| Moment | p50 | Guard pass |
|---|---|---|
| reading-like pattern | 5,912 ms | 5/5 |
| off-screen | 6,670 ms | 5/5 |
| second face | 4,782 ms | 5/5 |

`ollama ps` after load: `qwen2.5:3b · 2.2 GB · 100% GPU · context 4096`.

Notes:
- 14 of 15 calls took 4.7–6.8 s. One off-screen call took 12.6 s. In the app, a call over `LLM.slowMs` (8 s) switches to a lighter installed model. On this laptop there is no lighter model installed, so the app stays on `qwen2.5:3b`. A call that fails or passes 20 s gets the template suggestion.
- An earlier run on the same day gave a cold load of 12,032 ms and p50 of 5,726 ms. That run used `max_follow_ups: 3` instead of the app's 2, so only the run above is reported.
- The GPU was not reserved for the benchmark: another session had loaded the same model just before the run, and other apps were open.
- Only `qwen2.5:3b` is installed, so there is no Qwen3 row and no lighter-model row.

## Browser measurements (audit run, 2026-10-10)

Machine: the laptop above (i5-13420H, RTX 3050 Laptop 4 GB, 7.7 GB RAM). This is **not** the PRD §14A.4 reference (RTX 4060 Laptop, 8 GB).

Method: Microsoft Edge headless driven by puppeteer-core, with `--use-fake-device-for-media-stream` (Chromium's synthetic 1280×720 @ 20 fps camera and beeping mic). Code is HEAD `20459db` plus the MediaPipe telemetry block in `src/vision/faceTracker.ts`. Scripts are not in the repo.

Caveats, read before using any number:
- **No face in the fake camera.** With no face, Face Landmarker runs only its face detector, not the 478-point mesh. Per-frame cost with a real face will be higher. All vision numbers below are a lower bound.
- **Headless WebGL ran on the Intel UHD iGPU** (`ANGLE (Intel, Intel(R) UHD Graphics … D3D11)`), not the RTX 3050. "GPU delegate" below means the iGPU. nvidia-smi VRAM did not change (2,169 MiB, all Ollama).
- The fake camera delivers 20 fps, so frame-locked fps cannot go above 20.
- Other audit agents were using the CPU, GPU, Ollama and other browsers at the same time. The first LLM latency below includes waiting behind their calls.
- The real meeting-window path and the Wi-Fi-off test were not run.

### Vision (fake camera, no face)

| Delegate | Load (model already cached) | Warm-up (first 10 calls) | Frame-locked fps | `detectForVideo` p50 / p95 / max | Back-to-back throughput (same frame, 3 s) |
|---|---|---|---|---|---|
| GPU (Intel UHD iGPU via WebGL) | 206 ms | 4,610 ms (shader compile) | 20.0 | 9.3 / 21.1 / 32.8 ms | 94 calls/s |
| CPU (XNNPACK WASM) | 199 ms | 293 ms | 19.3 | 11.9 / 30.0 / 55.9 ms | 90 calls/s |

JS heap after both landmarkers: 23–28 MB (`performance.memory.usedJSHeapSize`). Browser process tree working set: 621 MB idle, 761 MB with both landmarkers loaded (10–11 processes; Windows working sets are noisy).

### Full pipeline (§14A.6)

| Test | Metrics | Result |
|---|---|---|
| Vision only | FPS, CPU, GPU, RAM, dropped frames | Fake camera, no face: 20 fps (camera-limited), per-frame 9.3 ms p50 on GPU / 11.9 ms on CPU (table above). CPU %, GPU % and dropped frames with a real face: PENDING MANUAL RUN |
| Vision + Dashboard | FPS, RAM, UI responsiveness | 5-minute live Session (webcam Source, controller + store running, no face): fps 20–21 every sample, JS heap 24.2–26.3 MB (no growth), browser tree 334 → 385 MB, 0 page errors. UI responsiveness with a real face: PENDING MANUAL RUN |
| Vision + Local LLM | LLM load time, generation latency, RAM/VRAM | LLM alone: table above (cold load 11.4 s, p50 5.9 s, 2.01 GB VRAM). In the browser with vision running: 3 suggestions took 17.5 s, 8.2 s, 6.1 s (`lastLatencyMs`; the first waited behind other agents' Ollama calls). VRAM stayed 2,169 MiB because headless vision used the iGPU. With vision on the RTX 3050: PENDING MANUAL RUN |
| Full pipeline | pattern → follow-up latency | Synthetic reading Flag injected into the store (Baseline set by hand): Flag → Moment opened 134 / 273 / 191 ms; Moment → suggestion ready 37.2 s / 8.2 s / 6.1 s (all `llm`, none template). With a real pattern from a real face: PENDING MANUAL RUN |
| Lightweight fallback | same metrics, smaller model / CPU path | CPU delegate measured above (11.9 ms p50, fake camera). 15 fps cap (`VISION.lightweightMaxFps`): covered by unit tests only, not measured in the browser — PENDING MANUAL RUN. Smaller LLM: not installed — PENDING MANUAL RUN |
| Offline mode | core AI loop continues with internet off (pass/fail) | Simulated offline (browser proxy to a dead port, loopback bypassed; `https://example.com` failed with `ERR_PROXY_CONNECTION_FAILED`): app load, MediaPipe WASM and model from `/mediapipe` and `/models`, Ollama via `/ollama`, three LLM suggestions and the Session Report (done in 4.7 s) all worked. 0 non-localhost requests over a 6-minute Session after the telemetry fix (before it, MediaPipe posted to `odml.pa.googleapis.com/v1/log`). Real Wi-Fi-off test: PENDING MANUAL RUN |

### Speech activity (fake / synthetic audio)

| Check | Result |
|---|---|
| Synthetic tone on 0–2 s, 3–5 s, 5.3–7 s | speaking at 0.21 s, pause at 2.27 s, speaking at 3.21 s, pause at 7.26 s. The 300 ms gap at 5–5.3 s was correctly bridged (shorter than the 400 ms release) |
| Detection delay | onset reported ~150 ms after it begins; pause reported ~400 ms after silence begins |
| Chromium fake mic (short beeps) | no transitions: the beeps are shorter than the 150 ms onset, so they never count as speech |
| Local Video with audio | `hasAudio: true`, speech states changed during playback (pause → speaking → pause → speaking → pause) |

### Sources

| Source | Result |
|---|---|
| Local Video (12 s webm made in the browser) | played, Signals at 21–25 fps, `ended` → Session finished 13.8 s after start. Seeking back while live worked (time 5.57 → 5.05 s; this webm has no cues so seeks are imprecise) |
| Local Video, invalid file | "This video file could not be played.", stays on the Source screen |
| Webcam, permission denied | "Camera access was not granted…" |
| Webcam, no camera (getUserMedia → `NotFoundError`, simulated) | "No camera was found on this laptop." |
| Window capture | headless with auto-selected "Entire screen": stream had 1 video and 1 audio track, "Speech context available". A single meeting window on a real desktop: PENDING MANUAL RUN |
