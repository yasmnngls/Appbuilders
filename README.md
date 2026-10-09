# Gazewise

**Notice. Follow up. Know when to move on.**

Gazewise is a local-AI interview assistant. During a remote job interview it watches the Candidate's video on the Interviewer's own laptop, notices when a gaze or face pattern is worth a closer look (a reading-like gaze pattern, gaze outside the usual range, the face out of view, a second face in view), and suggests one neutral follow-up question about the topic being discussed. After the follow-up it watches again and tells the Interviewer whether the pattern settled, so they can move on.

All analysis runs on the Interviewer's laptop. No video, images or face data leave the device, and nothing is saved unless the Interviewer exports a report.

Built for the AppBuildersPH Hackathon 2026 (theme: Local AI).

## Who it's for

Hiring managers, technical interviewers and recruiters who run remote interviews on Google Meet, Zoom, Teams or an assessment platform and want help knowing **when a follow-up question is worth asking**. Gazewise supports the Interviewer's judgement; it does not score or judge the Candidate.

## The loop

```
Observe → Explore → Re-observe → Resolve → Move On
```

1. **Observe** — after a ~15 s Baseline of the Candidate's normal gaze, local rules raise Flags (observations, not verdicts).
2. **Explore** — when the evidence gate decides a pattern is a *Moment worth exploring*, the local LLM writes a short factual Interviewer Note and one neutral follow-up about the Question's topic.
3. **Re-observe** — after the Interviewer asks it, Gazewise watches the answer.
4. **Resolve** — the pattern either settles ("Observation settled ✓") or continues; at most 2 follow-ups per Question.
5. **Move On** — the Interviewer goes to the next Question (press **N**). The Session Report records each Question's journey.

The rules detect; the language model only writes. A Flag is a prompt for a follow-up, never a conclusion.

## Requirements

- Node.js 20+
- Chrome or Edge (Chromium; uses `getDisplayMedia`, WebGL/WebGPU for MediaPipe)
- [Ollama](https://ollama.com) running locally
- Windows x64 for the bundled whisper.cpp setup script (local speech recognition)

## Setup

```bash
ollama pull qwen2.5:3b       # the model used on the tested laptop
# optional: ollama pull qwen3:4b  /  ollama pull qwen3:1.7b
npm install
npm run whisper:setup        # one time: downloads whisper.cpp (b5454, CPU) + tiny.en/base.en models into tools/ (gitignored)
npm run whisper              # local speech recognition on 127.0.0.1:8178 (keep running)
npm run dev                  # http://localhost:5173
```

Speech recognition is whisper.cpp `tiny.en` on the CPU (4 threads), so the GPU stays free for the LLM. Override with `WHISPER_MODEL`, `WHISPER_THREADS`, `WHISPER_GPU=1`. Without it running, Flags still work but no follow-up is suggested, because follow-ups need the transcript.

The app picks the first installed model from `qwen3:4b` → `qwen3:1.7b` → `qwen2.5:3b`. If a call is slow (over 8 s) or times out, it steps down to the next lighter installed model for the rest of the Session (lightweight mode). If no model is available, it uses deterministic template suggestions so the loop still works.

The MediaPipe WASM runtime and Face Landmarker model are committed under `public/`, so the app loads with no network. `npm run assets` re-fetches them if needed.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:5173 (Ollama proxied at `/ollama`) |
| `npm run build` / `npm run preview` | Type-check, production build, serve the build (also proxies Ollama) |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | TypeScript only |
| `npm run assets` | Re-download the vendored MediaPipe files into `public/` |
| `npm run whisper` / `npm run whisper:setup` | Start / install local whisper.cpp |
| `npm run bench:whisper` | Whisper latency/RAM/accuracy benchmark |
| `npm run bench:llm` | Local LLM follow-up benchmark, Cases A–G on the real model (see [docs/BENCHMARK.md](docs/BENCHMARK.md)) |
| `npm run landing:dev` / `npm run landing:build` | Landing site in `landing/` |

### Using it

1. Enter the Candidate's name and confirm consent (no camera or mic is opened before this).
2. Choose a Source:
   - **Online Interview:** share the meeting's **browser tab** with "Share tab audio", or the **entire screen** with "Share system audio". A single app window has no audio in Chrome, and the app says so.
   - **Local Webcam:** in person; one shared mic.
   - **Local Video:** a recorded file.
   Pick your **Microphone (Interviewer)**. Use headphones so your mic doesn't pick up the Candidate.
3. Let the Baseline finish (~15 s), then just interview. Your spoken question becomes the current Question automatically. "Mark new question" (**N**) is only a fallback.
4. When a Moment worth exploring appears, it shows a follow-up chosen from the Candidate's actual answer, with **Why this follow-up** (question → what was covered → what was unclear). If the answer already covers the question, it says "No follow-up suggested". **Ask**, **Continue** or **Dismiss**. Click any Flag for Flag Details.
5. **End session** for the Session Report; export PDF (browser print), Markdown or JSON.

## Landing site

A separate static site lives in `landing/` (its own `package.json`; it imports nothing from `src/`).

```bash
npm --prefix landing install
npm run landing:dev
npm run landing:build        # output in landing/dist
```

Deploy by importing the repo into Vercel with **Root Directory = `landing`** (framework preset Vite, build `npm run build`, output `dist`).

## Why local AI

- **Privacy is the product.** Face and eye data is sensitive personal information under the Philippine Data Privacy Act. Gazewise analyses each frame in memory on the Interviewer's laptop and discards it: no upload, no stored footage, nothing for a vendor to hold.
- **Real time without bandwidth.** Gaze analysis needs many frames per second. Sending them to a cloud API for a 45-minute interview would cost bandwidth, latency and money per call. On-device it is immediate and free.
- **The AI keeps working offline.** Vision, rules, the follow-up loop and the language model all run on localhost, so the analysis layer continues with the internet off.

## What runs locally

| Component | Where it runs |
|---|---|
| Face and iris tracking (MediaPipe Face Landmarker) | Locally, in the browser (GPU, CPU fallback) |
| Speech activity (energy VAD for the evidence gate) | Locally, in the browser (Web Audio) |
| Speech recognition (Interviewer mic + interview audio) | Locally, whisper.cpp `whisper-server` on `127.0.0.1:8178` via the `/whisper` proxy |
| Question detection, answer context, gap analysis | Locally, in the browser (plain TypeScript) |
| Baseline, Flag rules, evidence gate, follow-up state machine | Locally, in the browser (plain TypeScript) |
| Interviewer Notes, follow-ups, Session Report text | Locally, Ollama on `127.0.0.1:11434` via the dev-server proxy |
| Report export (PDF / Markdown / JSON) | Locally, in the browser |
| The video call itself (Meet / Zoom / Teams) | The interview platform, over the internet. Local Webcam and Local Video need no internet |

## Privacy

- Nothing is stored until the Interviewer exports a report. Closing the tab discards the Session.
- No images: frames are analysed in memory and dropped; exports contain text only (Flags, Notes, follow-ups, timeline).
- Audio is never recorded or stored. Finished utterances (≤15 s, in memory) are sent only to the local whisper.cpp server on this laptop; the text is kept in memory.
- The transcript text is included only in the JSON export. The Markdown/PDF report shows "Interviewer speech" / "Candidate speech" without the words.
- The LLM receives a small context window: Question, the Candidate's current answer (≤1200 chars), recent exchange, previous follow-ups, and the observation as context. Never video, images, landmarks or audio.

## Source audio

Two uses of audio:

1. **Speech activity** (energy VAD, as before) tells the evidence gate whether the Candidate is talking or pausing, so a thinking glance isn't counted.
2. **Speech recognition** (whisper.cpp, local) turns finished utterances into text. Questions and answers come from this text.

Speakers are separated **by source, not by voice**. Mic = Interviewer, meeting/file audio = Candidate. With one shared mic (webcam), lines are "mixed", and question-shaped lines are treated as the Interviewer's.

| Source | Interviewer | Candidate | Notes |
|---|---|---|---|
| Online Interview (tab share) | Mic | Tab audio ("Share tab audio") | Recommended for the meeting demo |
| Online Interview (entire screen) | Mic | System audio ("Share system audio", Windows) | Hears everything the laptop plays |
| Online Interview (single window) | Mic | **None:** Chrome gives no audio for a window | The app tells you to share the tab or the screen instead. No transcript means no follow-ups, and the gate uses stricter visual-only thresholds |
| Local Webcam | Shared mic ("mixed") | Shared mic ("mixed") | In-person |
| Local Video | Mic | The file's audio (never played to the speakers) | |

## Offline test

> **"The interview platform may use the internet. Our AI analysis layer does not need the cloud."**

We do not claim Meet, Zoom or Teams keep working without the internet. The offline test shows that the **local AI layer** keeps working.

Before the event:

1. `ollama pull qwen2.5:3b` (and any Qwen3 model you want), then `npm install`.
2. Check `public/` holds the MediaPipe WASM files and `face_landmarker.task` (no CDN at runtime).
3. `npm run build && npm run preview`, open the app once while online.

Offline run (PRD §20):

1. Start Gazewise while connected.
2. Choose **Local Webcam** or **Local Video** as the Source.
3. Let the Baseline finish.
4. Turn Wi-Fi off (or disable the network adapter). The status bar shows Offline.
5. Keep observing locally.
6. Trigger a known Flag (e.g. read a paragraph from a second window for ~10 s).
7. A local Interviewer Note appears, and the transcript keeps updating (local whisper).
8. A follow-up appears that targets what the answer left unclear, or "No follow-up suggested" if it was complete.
9. Ask it; Gazewise re-observes.
10. Show "Observation settled ✓" (or the pattern continuing), then move on and End session; export the PDF with Wi-Fi still off.

Checklist: in DevTools → Network, only `localhost` requests appear. (`@mediapipe/tasks-vision` has a built-in usage logger that posts task metrics to `odml.pa.googleapis.com` every 60 s; Gazewise refuses that request in `src/vision/faceTracker.ts`, so it never leaves the laptop.) Measured results go in [docs/BENCHMARK.md](docs/BENCHMARK.md).

## What it does not do

To keep the product honest, these are explicitly out of scope:

- It does not decide whether a Candidate is cheating, lying or dishonest, and never uses those words in its output.
- It does not detect deception, emotion, nervousness or personality, and does not score a "risk" or integrity level.
- It does not record, store or upload video, images or audio. The transcript stays on the laptop.
- It does not decide what to ask from a gaze signal. Follow-ups come from the conversation only.
- It does not reject or rank Candidates. The Interviewer decides.

## Limits

- Webcam gaze estimates are approximate; gaze is judged relative to each Candidate's own Baseline, not as screen coordinates.
- The reading-like pattern rule looks for a repeated sweep-and-return rhythm. Someone can read without it, and natural eye movement can resemble it, which is why every Moment leads to a follow-up question rather than a conclusion.
- Speech recognition (tiny.en) was measured on clean synthetic speech; accents, noise and crosstalk will lower accuracy. Without headphones, the Interviewer's mic can pick up the Candidate.
- The gap check covers three areas (personal contribution, specific steps, outcome) and suits experience/behavioural questions. For other kinds of question these checks may not fit; the suggestion is advisory and the Interviewer decides.
- In meeting-window mode the face is smaller and compressed and there is usually no audio, so signals are noisier and thresholds are stricter.

## Disclosures

- **Models:** MediaPipe Face Landmarker (`face_landmarker.task`, float16, Google). whisper.cpp (ggml-org, release b5454) with OpenAI Whisper `tiny.en` (`ggml-tiny.en.bin`; `base.en` optional). Local LLM via Ollama: Qwen2.5 3B Instruct (`qwen2.5:3b`, tested); Qwen3 4B / Qwen3 1.7B (`qwen3:4b`, `qwen3:1.7b`) used automatically if installed.
- **Frameworks and libraries:** React, Vite, TypeScript, Tailwind CSS, MediaPipe Tasks Vision (`@mediapipe/tasks-vision`), whisper.cpp, Ollama, Vitest.
- **APIs and cloud services:** none at runtime for the core loop. The Ollama HTTP API is on localhost. MediaPipe's built-in usage logging (`odml.pa.googleapis.com`) is blocked in the app. The landing site is static hosting only.
- **Existing code and assets:** none; built during the hackathon. Third-party packages above are unmodified.
- **AI development tools:** Claude Code.
- **Tested hardware:** ASUS Vivobook K3605VC — Intel Core i5-13420H, NVIDIA GeForce RTX 3050 Laptop GPU 4 GB, 7.7 GB RAM, Windows 11, Ollama 0.40.1, `qwen2.5:3b`. Measurements: [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Docs

| Doc | What it covers |
|---|---|
| [docs/PRD-product.md](docs/PRD-product.md) | Product requirements (source of truth) |
| [docs/PRD-landing-page.md](docs/PRD-landing-page.md) | Landing site requirements |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, data flow, local AI boundary |
| [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) | Per-module build plan |
| [docs/USER_JOURNEY.md](docs/USER_JOURNEY.md) | Interviewer journey through the app |
| [docs/SITEMAP.md](docs/SITEMAP.md) | Screens and landing sections |
| [docs/BENCHMARK.md](docs/BENCHMARK.md) | Measured performance on the tested laptop |
| [CONTEXT.md](CONTEXT.md) | Domain vocabulary |

## License

[MIT](LICENSE)
