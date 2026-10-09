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

Measured on 2026-10-10 against the **v1.2 contract** (follow-up from the Question label + Flags), with the since-retired `scripts/bench-llm.mjs` (see git history). The cold-load, latency and memory numbers still describe the model on this laptop. The **v1.3** transcript-grounded contract is measured in "Follow-up reasoning (live)" below; `npm run bench:llm` now runs that benchmark.

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

## Local speech recognition (whisper.cpp)

Measured 2026-10-10 on the tested laptop: Intel Core i5-13420H (8 cores / 12 threads), NVIDIA RTX 3050 Laptop 4 GB, 7.7 GB RAM, Windows 11.
whisper.cpp official prebuilt release `b5454` (`whisper-bin-x64.zip`, CPU; `whisper-bin-win-cuda-12.4.0-x64.zip` for the GPU check), models `ggml-tiny.en.bin` (74 MB) and `ggml-base.en.bin` (141 MB) from huggingface.co/ggerganov/whisper.cpp. Installed with `npm run whisper:setup`.

**Method** (`npm run bench:whisper`, script `scripts/bench-whisper.mjs`):
- Test speech generated offline with Windows SAPI (`scripts/whisper-tts.ps1`, written directly as 16 kHz 16-bit mono WAV):
  question "Tell me about a difficult project you've worked on." (3.4 s) and answer "I worked on a web application with my team. The backend was difficult, but eventually we finished it." (12.7 s, slowed SAPI rate).
- A fresh `whisper-server` per model on 127.0.0.1, 4 threads, `-l en -nt`, CPU (`-ng`). Each utterance is POSTed to `/inference` as multipart WAV (`response_format=json`, `temperature=0`). Latency is the full HTTP round trip.
- "First request" = first request for that utterance after the server started; then 5 warm runs, p50 reported.
- RAM = server working set (`tasklist`), idle after load and the peak sampled during all requests.
- Accuracy = word error rate against the reference text (case and punctuation ignored).

| Model (CPU, 4 threads) | Ollama | Load | RAM idle / peak | Question 3.4 s: first / warm p50 | Answer 12.7 s: first / warm p50 | WER |
|---|---|---|---|---|---|---|
| tiny.en | not loaded | 0.39 s | 126 / 167 MB | 403 / 503 ms | 499 / 548 ms | 0% / 0% |
| base.en | not loaded | 0.68 s | 206 / 256 MB | 1203 / 1355 ms | 1091 / 1441 ms (warm runs up to 2606 ms) | 0% / 0% |
| tiny.en | qwen2.5:3b loaded (2.2 GB, 100% GPU, idle) | 0.29 s | 126 / 169 MB | 572 / 509 ms | 584 / 640 ms | 0% / 0% |
| base.en | qwen2.5:3b loaded (idle) | 0.58 s | 206 / 259 MB | 1810 / 1290 ms | 1354 / 1414 ms | 0% / 0% |

Both models transcribed both utterances word for word ("Tell me about a difficult project you've worked on." / "I worked on a web application with my team. The backend was difficult, but eventually we finished it.").

**GPU check (optional CUDA build, tiny.en, Ollama loaded):** it works. Load 3.4 s, first request 462 ms, then warm p50 51 ms (question) and 75 ms (answer), WER 0%. RAM 294 / 448 MB. Total VRAM with qwen2.5:3b and whisper tiny.en both loaded was 2456 of 4096 MiB (2161 MiB with Ollama alone). Whisper on the GPU *while the LLM is generating* was not measured: PENDING MANUAL RUN.

**Choice: `tiny.en` on CPU, 4 threads** (the default of `npm run whisper`). It is the smallest model, its accuracy on these clean utterances was the same as base.en (0% WER), and it handles a 12.7 s answer in about 0.5–0.65 s, well under the 2 s target. base.en was 2–3× slower with spikes up to 2.6 s and gave no accuracy gain here. Running on the CPU leaves the 4 GB GPU to the LLM; `WHISPER_GPU=1 npm run whisper` switches to the CUDA build if it is installed (`npm run whisper:setup -- -Cuda`).
Not measured: accuracy on real microphone or meeting audio with accents and noise (SAPI speech is clean), and latency while the LLM is generating at the same time: PENDING MANUAL RUN.

**Network check:** during inference, `netstat -ano` for the whisper-server PID showed only `LISTENING 127.0.0.1:<port>` and loopback `ESTABLISHED` connections from the benchmark client: no non-loopback bind and no non-loopback remote peer (all four runs and the CUDA run). The server binds to 127.0.0.1 only (`--host 127.0.0.1`), and the browser reaches it only through the same-origin `/whisper` Vite proxy.

## Follow-up reasoning (live)

`npm run bench:followup` runs Cases A–G and the hero demo (`src/context/testing/followUpCases.ts`, the same inputs as `src/context/followUpReasoning.test.ts`) through the real `writeSuggestion`: the same analyzer, system prompt, JSON schema, guard and templates as the app, against the local Ollama. "Pass" means the final suggestion met the case: no follow-up for A/E/G2; otherwise the expected gap, traceable to an analyzer gap, with no observation or banned wording, and the topic word where one is required. "Model right" compares the raw model verdict with the expectation, before the deterministic wrapper.

Model: `qwen2.5:3b` via http://127.0.0.1:11434 · 3 runs per case · warm-up 251 ms · 13th Gen Intel(R) Core(TM) i5-13420H, 8 GB RAM · 2026-10-09 23:15 UTC

| Case | Expected | Pass | Model said (raw) | Model right | Final follow-up (run 1) | Gap | Source | Wall ms (median) | Model call ms (median) |
|---|---|---|---|---|---|---|---|---|---|
| A complete answer | none | 3/3 | not called | — | (none) | — | fallback, none | 3 | — |
| B team but not self | personal | 3/3 | gap: personal contribution | 3/3 | What specific tasks did you handle in the project? | personal contribution | llm | 5026 | 5020 |
| C solved, no how | steps | 3/3 | gap: specific steps | 3/3 | What specific steps did you take to solve the login flow bug? | specific steps | llm | 5337 | 5336 |
| D situation + action, no result | outcome | 3/3 | gap: outcome | 3/3 | What was the outcome of fixing the payment service issues? | outcome | llm | 5399 | 5398 |
| E Flag + complete answer | none | 3/3 | not called | — | (none) | — | fallback, none | 0 | — |
| F Flag + gap | personal + "billing" | 3/3 | gap: personal contribution | 3/3 | What specific tasks did you perform during the migration? | personal contribution | llm | 5096 | 5095 |
| G repeat: personal already asked | steps/outcome | 3/3 | gap: specific steps | 3/3 | How did you approach and resolve the backend difficulties? | specific steps | llm | 5028 | 5027 |
| G2 repeat: no gap left | none | 3/3 | not called | — | (none) | — | fallback, none | 0 | — |
| HERO hero demo | personal/steps + "backend" | 3/3 | gap: personal contribution | 3/3 | What specific tasks did you perform on the backend? | personal contribution | llm | 5074 | 5073 |

Total: 27/27 runs met the expectation.

Raw model probe (one call per case, no wrapper; the app never sends A/E/G2 to the model):

| Case | Expected | Model: covers? | Model: gap | Model follow-up | Guard | Model right | ms |
|---|---|---|---|---|---|---|---|
| A | none | false | specific steps | What specific steps did you take to profile and optimize the database queries? | pass | **no** | 5903 |
| B | personal | false | personal contribution | What specific tasks did you handle in the project? | pass | yes | 5427 |
| C | steps | false | specific steps | What specific steps did you take to solve the login flow bug? | pass | yes | 5535 |
| D | outcome | false | outcome | What was the outcome of fixing the payment service issues? | pass | yes | 5597 |
| E | none | false | specific steps | What specific steps did you take to profile and optimize the database queries? | pass | **no** | 5956 |
| F | personal | false | personal contribution | What specific tasks did you perform during the migration? | pass | yes | 5479 |
| G | steps/outcome | false | specific steps | How did you approach and resolve the backend difficulties? | pass | yes | 5284 |
| G2 | none | false | specific steps | What specific steps did you take to split the work into the front end and data pipeline? | pass | **no** | 6039 |
| HERO | personal/steps | false | personal contribution | What specific tasks did you perform on the backend? | pass | yes | 5652 |

An earlier run on the same machine, a few minutes before (log only, same 27/27 result), measured 1.6–2.3 s per model call for B–G and 5.1–5.7 s for the hero demo. The run above measured about 5 s per call for every case. Other work was running on the laptop at the same time; the cause of the difference was not measured.

Findings:
- **qwen2.5:3b never answers `answer_covers_question: true`, even for a complete answer.** In the raw probe it invents a "specific steps" gap for A/E (complete answer) and for G2 (the only gap was already asked). The wrapper makes this harmless: the analyzer decides complete, too-brief, no-transcript and all-gaps-asked cases, and in those cases the model is never called for a follow-up.
- When the analyzer finds a gap, the model picks the same gap in every run (B, C, D, F, G, hero) and its wording passed the guard, so the app showed the model text (source `llm`).
- In G, the model respected `previous_follow_ups` and moved to "specific steps" instead of asking about personal contribution again.
- For the hero demo the model said "What specific tasks did you perform on the backend?" (personal contribution, reusing "backend").
- The model sometimes writes an `interviewer_note` about the answer ("Candidate described team's work…") instead of the observation. The note check (KIND_WORDS) rejects it and the deterministic observation note is shown.

## Full pipeline, live Session (v1.3)

Run on 2026-10-10 in headed Chrome with fake devices:
- **Mic:** a SAPI speech WAV with the question, then the hero answer.
- **Camera:** a gray Y4M (no face, so a Face-missing Flag).
- **Services:** the dev server, whisper `tiny.en` (CPU, 4 threads) and Ollama `qwen2.5:3b` (GPU).

The pipeline ran Consent → Webcam → Baseline → transcript → spoken Question (Q2) → gate → follow-up. It did so twice; both runs gave "What specific tasks did you perform on the back end?" (gap: personal contribution). No request left localhost.

| Measure | Value |
|---|---|
| whisper-server working set | 130 MB |
| Ollama runner working set (model in VRAM) | 35 MB RAM; GPU memory 2169 MiB |
| All Chrome processes (includes other open Chrome windows) | 998 MB |
| System RAM in use (dev tools and agents also open) | 7362 / 7862 MB |
| Clean-machine total, real voices, real meeting tab | PENDING MANUAL RUN |
