# Architecture — Local AI Interview Assistant

> Derived from [PRD-product.md](./PRD-product.md) v1.2 — if they disagree, PRD-product.md wins.
> Vocabulary follows [CONTEXT.md](../CONTEXT.md) and PRD §7.
>
> **v1.3 update (2026-10-10):** a local speech-recognition layer was added. whisper.cpp runs on 127.0.0.1:8178 behind the `/whisper` proxy and transcribes the Interviewer's mic and the interview audio. Questions are detected from speech, and follow-ups are chosen from the transcript (`src/context/*`); vision only gates. The diagrams below show the v1.2 vision path, which is unchanged. See PRD §14 (v1.3) and BUILD_PLAN "v1.3 Architecture Change" for the full pipeline.

## 1. System overview

The repository ships **two deployables** that share nothing at runtime:

```text
┌──────────────────────────────┐        ┌──────────────────────────────────────────────┐
│ LANDING SITE (static)        │        │ INTERVIEWER'S LAPTOP                          │
│ Hosted (e.g. Vercel)         │  link  │                                               │
│ Marketing, demo video, docs  │ ─────▶ │  Browser (Chrome/Edge)                        │
│ No Candidate data, ever      │        │  ┌─────────────────────────────────────────┐  │
└──────────────────────────────┘        │  │ INTERVIEWER APP (localhost:5173)        │  │
                                        │  │ capture → vision → rules → store → ui   │  │
┌──────────────────────────────┐        │  │                    │                    │  │
│ EXISTING INTERVIEW PLATFORM  │ video  │  │                    ▼ /ollama proxy      │  │
│ Meet / Zoom / Teams /        │ ─────▶ │  └────────────────────┼────────────────────┘  │
│ assessment platform          │ window │                       ▼                       │
│ (interview transport only)   │capture │  Ollama (localhost:11434) — local LLM         │
└──────────────────────────────┘        └──────────────────────────────────────────────┘
```

- **Interviewer App**: the product. Runs entirely on the Interviewer's laptop. Candidate video never leaves the device (PRD §16).
- **Landing Site**: a static marketing page ([PRD-landing-page.md](./PRD-landing-page.md)). It has no backend and never touches Candidate data.
- **Existing interview platform**: conducts the interview. The app only captures its window (PRD §8 "Local AI Layer").
- **Ollama**: the local LLM server, reached only through the app's localhost proxy.

## 2. Interviewer App pipeline

This maps PRD §14 onto source modules under `src/`:

```text
capture/      Source: window (getDisplayMedia) | webcam (getUserMedia) [| local video, P1]
   │  video frames                       │ audio track (if available)
   ▼                                     ▼
vision/       MediaPipe Face Landmarker  audio/   Speech activity: speaking | pause
              (GPU delegate, CPU fallback)        (energy-based, local, no transcription)
   │  Signal {t, faceCount, headYaw, headPitch, gazeX, gazeY}
   ▼                                     │
rules/        Baseline → 4 Flag rules → EVIDENCE GATE ◀───────┘
              → follow-up state machine
   │  Flags, Moments, follow-up phase transitions
   ▼
store/        Session (Questions, Flags, Moments, FollowUpState, Timeline) — in memory only
   │                       │  Moment opened / persisting
   ▼                       ▼
ui/           Live dashboard            llm/   Ollama: Interviewer Note + Follow-up (§28 contract)
              Follow-up card                   banned-word guard → retry → deterministic fallback
              Session Report → export          hardware-aware model selection
```

| Module | Responsibility | PRD |
|---|---|---|
| `capture/` | Open and stop the Source; crop to the Candidate tile in window mode | FR-002 |
| `vision/` | Run FaceLandmarker per frame and turn results into Signals (head pose from the transform matrix, iris offset → gaze) | FR-003 |
| `audio/` | Speech-activity state with hysteresis; `unavailable` when there is no audio track | FR-005A |
| `rules/` | Baseline (median/MAD over ~15 s), the four Flag rules, evidence gate, follow-up state machine. Pure TypeScript, unit-tested, thresholds in `rules/config.ts` | FR-004 – FR-006, FR-010, FR-015 – FR-017 |
| `store/` | External store read via `useSyncExternalStore`, throttled to ~10 Hz | FR-007, FR-018 |
| `llm/` | Event-driven Ollama calls, prompt contract, quality/banned-word guard, model selection, Session Report | FR-011 – FR-013, FR-020, §14A, §28 |
| `ui/` | Screens from [SITEMAP.md](./SITEMAP.md) | §13 |
| `app/controller.ts` | Wires everything that isn't React | — |

### Architectural principles

1. **Rules detect; the LLM only writes.** Deterministic temporal logic decides whether a moment is worth exploring. The LLM turns a grounded observation into neutral language (FR-011).
2. **The LLM never sees video.** Its input is structured context only: Question, Flags, follow-up count (§28).
3. **Event-driven LLM.** It is called only when the evidence gate opens a Moment or a pattern persists after a follow-up. It is never called continuously (§14A.3).
4. **Precision over frequency.** When evidence is weak, keep observing (§18.5).
5. **The vision loop never touches React.** Frames update the store, and the UI reads it throttled.
6. **One local LLM at a time**, kept warm with `keep_alive` (§14A.4).
7. **Interviewer in control.** The AI never asks, interrupts or decides (§18.2).

## 3. Evidence gate and follow-up loop

### 3.1 Event categories (FR-005)

| Category | Meaning | Action |
|---|---|---|
| Ordinary | Expected or brief behaviour | None |
| Transient | Notable but short or isolated | Continue observing |
| Patterned | Meets a Flag threshold | Raise a Flag |
| Worth exploring | A Patterned event that passes the evidence gate | Open a **Moment worth exploring** |

### 3.2 Evidence gate (initial thresholds, tuned on the demo laptop)

A Moment opens on the first of these. Time before the gate's floor (the later of grace end and `watchFrom`) never counts. A Flag still running at the floor counts for the time after it, unless the Interviewer pressed Continue on it. That covers a pattern carried across an Ask, out of the grace window, or into a new Question:

| Trigger | Threshold |
|---|---|
| Reading pattern | Any Reading pattern Flag (the rule already requires 4 consistent line sweeps) |
| Second face | Held ≥ 3 s |
| Face missing | Held ≥ 5 s |
| Looking off-screen, sustained | One Flag held ≥ 6 s (≥ 8 s when speech context is unavailable) |
| Looking off-screen, repeated | ≥ 3 Flags within 60 s (≥ 4 when speech context is unavailable) |

The gate **never** opens:
- for gaze triggers (off-screen, reading) before the Baseline is ready. Face triggers work without it;
- in the first 10 s of a Question (thinking time);
- on an off-screen glance inside a speech pause of ≤ 4 s after which speech resumed (dead-air / thinking case, PRD §11.1). A glance inside a still-open pause is not counted yet.

All values live in `rules/config.ts` (`RULES.followUp`).

### 3.3 Follow-up state machine (per Question)

```text
                    gate opens
   observing ─────────────────────▶ worth_exploring
      ▲  ▲                            │      │      │
      │  │ Continue                   │ Ask  │      │ Dismiss
      │  └────────────────────────────┘      │      ▼
      │                                      │   dismissed ■
      │                                      ▼
      │                               re_observing (30 s)
      │                         no trigger │        │ trigger again
      │                                    ▼        ▼
      │                               settled ■   used < 2 ──▶ persisting ──Ask──▶ re_observing
      │                                           used = 2 ──▶ limit_reached ■
      └──────────── Continue (from persisting) ─────────────────┘

   ■ = stops suggesting for this Question.   New Question (N) → fresh state: observing, used = 0.
```

| State | Meaning | UI (PRD §13 Screens 6–7) |
|---|---|---|
| `observing` | Watching; no Moment open | Nothing extra |
| `worth_exploring` | Gate opened; Note + Follow-up shown | "Moment worth exploring" · Follow-up n / 2 · Ask / Continue / Dismiss |
| `re_observing` | Follow-up asked; watching for 30 s | "Re-observing…" |
| `settled` | No further trigger during re-observation | "Observation settled ✓ No further follow-up suggested." |
| `persisting` | Trigger again with budget left | "Pattern continues. One final follow-up is available." |
| `limit_reached` | Trigger again after 2 follow-ups | "Follow-up limit reached." |
| `dismissed` | Interviewer dismissed suggestions for this Question | Nothing further |

- **Limit:** `MAX_FOLLOW_UPS = 2` per Question (§11.2), enforced in the state machine, not only in the UI (FR-015).
- **Ask** spends one follow-up, sets `reObserveUntil = t + 30 s` and moves `watchFrom` to t.
- **Continue** keeps the budget and moves `watchFrom` to t, so the same Flags don't re-trigger.
- Every transition appends a **Timeline** event (FR-018).

## 4. Data model

PRD §17, as TypeScript types (`src/domain/types.ts`):

```text
Session
├── candidateName, consentAt, startedAt, endedAt, source
├── baseline: Baseline | null              {centreX, centreY, spreadX, spreadY}
├── questions: Question[]                  {id, number, label, start}
├── flags: Flag[]                          {id, kind, start, end|null, questionId, detail}
├── moments: Moment[]                      {id, questionId, t, kind, reason, flagIds, followUpNumber,
│                                           note, followUp, quality, suggestion, decision,
│                                           askedAt, result: settled|persisting|null}
├── followUp: FollowUpState                {questionId, phase, used, reObserveUntil, momentId, watchFrom}
├── timeline: TimelineEvent[]              {t, kind, questionId, text}
└── report: SessionReport | null           {summary, perQuestion[], generatedAt}
```

- Flag kinds: `off-screen`, `reading-pattern`, `face-missing`, `second-face`.
- Times are ms since Session start.
- A Flag belongs to the Question active when it started (FR-007).
- The Interviewer Note (FR-011) is stored on its Moment.

## 5. Local LLM

| Aspect | Decision |
|---|---|
| Runtime | Ollama on `localhost:11434`, reached via the Vite proxy `/ollama` |
| Model preference | `qwen3:4b` → `qwen3:1.7b` → `qwen2.5:3b` (first installed wins; Qwen3 runs with thinking off) |
| Lightweight mode | If a call takes > 8 s or fails, step down to the next smaller installed model (§14A.5) |
| Output | JSON schema, temperature 0, `keep_alive` 30 min |
| Input contract | `{question, recent_flags[{type, timestamp, description}], follow_up_count, max_follow_ups}` (§28) |
| Output contract | `{interviewer_note, follow_up, quality{specific, neutral, grounded}}` |
| Guard | Banned-word check (§18.1) plus quality flags → one retry → deterministic fallback text built from the Flag |
| When called | Moment opened, pattern persisting, and Session end (Session Report) |
| If unavailable | Flags, gate and state machine keep working; fallback text is used |

## 6. Connectivity and privacy

| Component | Internet required? |
|---|---|
| Existing interview platform / Meet / Zoom / Teams transport | Yes |
| Meeting-window capture | No additional AI cloud dependency |
| Local webcam, local video | No |
| Vision inference, Baseline, Flags, evidence gate, follow-up loop | No |
| Speech activity | No |
| Local LLM (Notes, follow-ups, report) | No |
| Session Report and export | No |
| Landing site | Yes (static hosting); holds no Candidate data |

- **Stored:** nothing until the Interviewer exports. Exports (PDF, Markdown, JSON) contain text and timestamps only, with no images or video.
- **Vendored assets:** the MediaPipe WASM and the `face_landmarker.task` model are committed under `public/`, so the app loads with no CDN.
- **Offline test (§20):** use Local Webcam or Local Video. If the network drops, the online meeting transport may stop; the AI layer does not.

## 7. Hardware strategy

- **Principle:** hardware acceleration makes the assistant faster, not different (§14A.5).
- **Vision:** GPU delegate with CPU fallback; the live fps is shown in the status bar.
- **LLM:** quantized small models, one at a time, event-driven.
- **Tested configuration:** see [PRD-product.md Appendix A](./PRD-product.md#appendix-a--implementation-notes-current-repo). Only measured numbers are quoted (§14A.6). Results go in `docs/BENCHMARK.md` once measured.

## 8. Repository layout

```text
/
├── src/                 Interviewer App (Vite + React + TypeScript + Tailwind)
│   ├── app/ audio/ capture/ domain/ llm/ rules/ store/ ui/ vision/
├── public/              Vendored MediaPipe WASM + face model (offline)
├── landing/             Landing Site (static HTML + Tailwind, built with Vite, deployed separately)
├── docs/                PRD-product, PRD-landing-page, ARCHITECTURE, SITEMAP, USER_JOURNEY
├── scripts/             Asset fetch script
├── CONTEXT.md           Glossary
└── README.md            Run instructions, disclosures, "why local AI"
```

## 9. Key decisions

| Decision | Rationale |
|---|---|
| Browser-only app, no backend | Nothing to deploy or secure; Candidate video stays in one process on one laptop |
| MediaPipe Face Landmarker, not ONNX Runtime, for the MVP | Satisfies FR-003 locally with GPU/CPU fallback and iris landmarks; fewer moving parts. ONNX stays an option (§14A.1) |
| Ollama via a localhost proxy | Simple local LLM server; the browser talks to it same-origin |
| Deterministic gate + state machine, with the LLM for language only | Explainable, testable, no mental-state inference (§18.6) |
| Separate static landing site | Marketing needs hosting; the tool must stay local. Keeping them apart keeps the privacy boundary obvious |
