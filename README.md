# Gazewise

**On-device interview observations.** Gazewise watches a remote job candidate's face during a video interview and tells the interviewer, in real time, when the candidate looks off-screen for a while, shows a **reading pattern** (eyes sweeping along lines of text, as when reading answers off a second screen), leaves the frame, or has a second person in view. A local language model turns those observations into short **Interviewer Notes** with follow-up questions, plus an end-of-interview report.

All of it runs on the interviewer's laptop. No video, images or face data leave the device, and nothing is saved unless the interviewer exports a text report.

Built for the AppBuildersPH Hackathon 2026 (theme: Local AI).

## Why does this product benefit from running AI locally?

- **Privacy is the product.** Face and eye data is sensitive personal information under the Philippine Data Privacy Act. A cloud proctoring tool has to stream a candidate's face to a third party. Gazewise analyzes each frame in memory on the interviewer's laptop and throws it away, so there is no upload, no stored footage and nothing for a vendor to leak.
- **Real time without bandwidth.** Gaze analysis needs every frame (about 30 per second). Sending that to a cloud API for a 45-minute interview costs bandwidth, adds latency and costs money per call. On-device, it's free and immediate.
- **Works with the internet off.** Webcam mode needs no network at all. Face tracking, the rules and the language model all keep running with Wi-Fi disabled.

## How it works

```
Meeting window (getDisplayMedia) or webcam (getUserMedia)
  → MediaPipe Face Landmarker, in the browser on the GPU (478 face + iris landmarks, head pose)
  → Signals: face count, head yaw/pitch, iris offset, gaze estimate
  → Rules (plain TypeScript, unit-tested): Baseline, Looking off-screen, Reading pattern, Face missing, Second face
  → Flags, grouped by interview Question
  → Ollama + qwen2.5:3b on localhost: Interviewer Notes every 30 s, end-of-session report (JSON-schema output)
```

The rules detect; the language model only writes. Flags are **observations, not verdicts**: the app never says "cheating".

## Run it

Requirements: Node 20+, [Ollama](https://ollama.com), a Chromium-based browser (Chrome or Edge).

```bash
ollama pull qwen2.5:3b
npm install
npm run dev          # http://localhost:5173
```

The MediaPipe WASM runtime and face model are committed under `public/` so the app loads with no network. `npm run assets` re-fetches them if needed.

1. Enter the candidate's name, pick **Meeting window** or **This laptop's webcam**, read the consent script to the candidate and tick the box.
2. In window mode, choose the Meet/Zoom window, then **Select candidate tile** and drag a box around the candidate's video.
3. The first ~15 s learns the candidate's normal gaze. Press **N** (or "Next question") each time you ask a new question.
4. **End session** to get the report; export it as Markdown or JSON.

Tests: `npm test`.

## What runs locally / what needs internet

| Component | Where it runs |
|---|---|
| Face and iris tracking (MediaPipe Face Landmarker) | Locally, in the browser (GPU, CPU fallback) |
| Rules that raise Flags | Locally, in the browser |
| Interviewer Notes and report (qwen2.5:3b via Ollama) | Locally, on localhost |
| The video call itself (Meet/Zoom) | Internet, only in meeting-window mode. Webcam mode needs no internet. |

## Disclosures

- **Models:** MediaPipe Face Landmarker (`face_landmarker.task`, float16, Google); Qwen2.5 3B Instruct (`qwen2.5:3b`) via Ollama.
- **Frameworks and libraries:** `@mediapipe/tasks-vision`, React, Vite, TypeScript, Tailwind CSS, Vitest.
- **APIs and cloud services:** none at runtime. The Ollama HTTP API is on localhost.
- **Existing code and assets:** none; built during the hackathon. Third-party packages above are unmodified.
- **AI development tools:** Claude Code.

## Limits (honest ones)

- Webcam gaze estimates are approximate; the app judges gaze relative to each candidate's own Baseline instead of claiming screen coordinates.
- The reading-pattern rule looks for a repeated sweep-and-return rhythm. Someone can read without that rhythm, and some natural eye movement can resemble it, so every Flag is a prompt for a follow-up question, not a conclusion.
- In meeting-window mode the candidate's face is smaller and compressed, so signals are noisier than in webcam mode.

## License

MIT
