# Build Plan — per module

> Derived from [PRD-product.md](./PRD-product.md) v1.2 — if they disagree, PRD-product.md wins.
> Implements [ARCHITECTURE.md](./ARCHITECTURE.md), screens from [SITEMAP.md](./SITEMAP.md), flows from [USER_JOURNEY.md](./USER_JOURNEY.md), landing from [PRD-landing-page.md](./PRD-landing-page.md).

This plan says, for every module: what it must do, which files change, the exact public API, the behaviour and edge cases, the tests that prove it, and when it counts as done. Thresholds are never written here as magic numbers in code: they live in `src/rules/config.ts`.

---

## 0. Conventions

### 0.1 Definition of Done (every module)

A module is done only when all of these are true:

1. `npm run typecheck` passes.
2. `npm test` passes, including the new tests listed for the module.
3. Each PRD requirement the module claims (FR-xxx) is met as written in PRD-product.md.
4. No banned word (PRD §18.1) appears in UI copy, prompts, fallback text or exports. This is enforced by the language test in §13.3.
5. Nothing sends Candidate data off the laptop. The only network calls are same-origin `/ollama/*` and the app's own assets.
6. The module has its own commit; the message names the module and the FRs it covers.

### 0.2 Size legend

- **S** = under ~1 h
- **M** = 1–3 h
- **L** = 3 h or more

These are rough sizes for ordering the work, not promises.

### 0.3 Starting point (step 0)

| | |
|---|---|
| Last good commit | `5124a72` (app) + `e840f62` (docs) |
| Uncommitted half-edits | `src/domain/types.ts`, `src/rules/config.ts`, `src/capture/source.ts`, `src/llm/ollama.ts`, `src/llm/notes.ts`, new `src/audio/speechActivity.ts` |
| Build state | **Broken.** `store/session.ts`, `app/controller.ts`, `llm/report.ts`, `ui/LiveScreen.tsx` and `llm/llm.test.ts` still reference the removed `notes`, `InterviewerNote`, `generateNote` and `startNoteLoop` |

The half-edits already match ARCHITECTURE.md:
- the types for Moment, FollowUpState and Timeline;
- `RULES.followUp`;
- audio on the Source;
- the model preference list;
- the speech detector.

**Recommendation: keep them and finish them** in modules 1–6 below; reverting would mean rewriting the same code. If you'd rather start clean: `git checkout -- src && rm -r src/audio`.

---

## 1. Build order

The order follows PRD §19, "Technical Reliability Strategy": the core loop first, then report and export, then extras.

```text
Phase A  M1 domain + M6 store          → build compiles again (unblocks everything)
Phase B  M2 rules: gate + state machine ┐
         M3 audio: speech activity      ├ independent, can run in parallel
         M5 llm: contract, guard,       │
            Moments, model selection    ┘
         M12 landing site               (fully independent, any time)
Phase C  M7 controller wiring          → loop works end to end, headless
Phase D  M8 UI: screens 1–4, cards 6–7, overlay 5
Phase E  M9 report + timeline + M10 PDF export
Phase F  M11 benchmark, README disclosures, offline rehearsal
Phase G  P1 polish: quality chips, Question Journey visuals, Local Video, diagnostics
```

### Demo-critical path

```text
M1 → M6 → M2 → M5 → M7 → M8 (Follow-up card) → M9 → M10
```

Everything else can be cut (see §15).

---

## M1 — `domain/` types

**PRD:** §7, §17, FR-006, FR-009, FR-018 · **Size:** S · **Depends on:** none

### Goal
One set of types that every module shares, matching ARCHITECTURE §4.

### File
`src/domain/types.ts` (already half-edited).

### Changes to finish
| Change | Why |
|---|---|
| `Session.source: "webcam" \| "window" \| "video"` | Local Video Source (FR-002, P1). The type is added now so later work doesn't ripple |
| `Session.speechAvailable: boolean` | Report and gate need to know whether visual-only thresholds were used (FR-005A) |
| `Session.llmModel: string \| null` | Disclose the model in the report (§14A.7) |
| `Flag.evidence?: FlagEvidence` | Explainable Flag (FR-009) |
| `Flag.dismissed?: boolean` | Flag Details → Dismiss: the Interviewer removes a Flag from the gate |
| `TimelineKind` adds `"flag"`, `"session-end"` | FR-018 lists Flags in the timeline |
| `Moment.origin: "gate" \| "interviewer"` | A Moment can come from the gate or from Flag Details → Explore |
| Remove every remaining reference to `InterviewerNote` / `notes` | The Note lives on the Moment (ARCHITECTURE §4) |

```ts
export interface FlagEvidence {
  /** Baseline gaze centre and spread at the time of the Flag, degrees. */
  baseline?: { centreX: number; centreY: number; spreadX: number; spreadY: number };
  /** Off-screen: threshold used (deg) and the largest deviation seen while the Flag was active (deg). */
  thresholdDeg?: { x: number; y: number };
  peakDeviationDeg?: number;
  direction?: "left" | "right" | "up" | "down";
  /** Reading pattern: line sweeps counted in the window. */
  cycles?: number;
  /** Second face: max faces seen. */
  faceCount?: number;
}
```

`direction` is from the Interviewer's view: the video is mirrored for the webcam, so the mapping is decided once in the engine (see M2) and documented there.

### Tests
None of its own; the typecheck covers it.

### Done when
The typecheck errors left are only in the modules that still use the old fields (fixed in M5–M8).

---

## M2 — `rules/`: Baseline, Flags, evidence gate, follow-up state machine

**PRD:** FR-004, FR-005, FR-006, FR-010, FR-014, FR-015, FR-016, FR-017, §11, §18.3–18.5 · **Size:** L · **Depends on:** M1

Everything here is **pure TypeScript**: no DOM, no timers, no React. Time always comes in as an argument. This is what makes it unit-testable and explainable (ARCHITECTURE §2, principle 1).

### M2.1 Flag engine changes (`rules/engine.ts`)

**Already built:**
- Baseline (`baseline.ts`);
- debounced off-screen, face-missing and second-face (`debounce.ts`);
- reading pattern (`readingPattern.ts`).

**Add evidence (FR-009):**
- `FlagTransition` gains `evidence?: FlagEvidence`.
- **On `start`:**
  - baseline snapshot;
  - threshold `{x: thrX, y: thrY}` (already computed in `offScreenScore`);
  - direction;
  - `cycles` for reading;
  - `faceCount` for second face.
- **While off-screen is active:** track the peak deviation (`max(|gazeX−centreX|, |gazeY−centreY|)`) in a private field.
- **On `end`:** emit `evidence: { peakDeviationDeg }`. The store merges it into the Flag.
- **Direction:** replace `describeDirection` with a typed `direction` plus a `detail` string. Today's detail is "looking up / down / to the side". Keep plain observation words such as "gaze moved to the right" (PRD §18.1 "gaze moved").

**Tests to add (`engine.test.ts`):**
- an off-screen Flag carries a baseline, threshold and direction on start, and a peak ≥ threshold on end;
- second face carries `faceCount: 2`;
- reading carries `cycles ≥ 4`.

### M2.2 Evidence gate (`rules/gate.ts`, new)

```ts
export interface GateInput {
  now: SessionTime;
  question: Question;
  followUp: FollowUpState;          // uses watchFrom
  flags: Flag[];                    // whole session; filtered inside
  baselineReady: boolean;
  speech: { available: boolean; pauses: Pause[] };
}

export interface GateHit {
  kind: FlagKind;
  /** Plain observable reason, e.g. "3 off-screen glances within 60 s". Shown in the UI and passed to the LLM. */
  reason: string;
  flagIds: string[];
}

/** First trigger that passes the gate, or null. Pure; called ~4×/s by the controller. */
export function evaluateGate(input: GateInput): GateHit | null;
```

**Eligible Flags.** A Flag counts only if all of these hold:
- `questionId === question.id`;
- `!dismissed`;
- `start >= followUp.watchFrom`;
- `start >= question.start + graceMs`.

**Never open (returns null):**
- the Baseline isn't ready;
- `now < question.start + graceMs` (10 s thinking time);
- the phase is anything other than `observing` or `re_observing`. In other phases the gate isn't asked at all, but guard here too.

**Triggers.** Evaluated in this fixed priority order so the result is deterministic:

| # | Kind | Passes when | Reason text |
|---|---|---|---|
| 1 | `second-face` | One eligible Flag with `(end ?? now) − start ≥ secondFaceMs` (3 s) | "A second face was visible for N s" |
| 2 | `face-missing` | One eligible Flag held ≥ `faceMissingMs` (5 s) | "The face was out of view for N s" |
| 3 | `reading-pattern` | Any eligible Flag | "A reading-like gaze pattern was observed (N line sweeps)" |
| 4 | `off-screen` sustained | One eligible Flag held ≥ `offScreenSustainedMs` (6 s), or `…NoSpeechMs` (8 s) if `!speech.available` | "Gaze moved outside the usual range for N s" |
| 5 | `off-screen` repeated | ≥ `repeatCount` (3), or `repeatCountNoSpeech` (4), eligible Flags with `start ≥ now − repeatWindowMs` (60 s) | "N off-screen glances within 60 s" |

**Thinking-pause filter (PRD §11.1, dead air).** This applies only to `off-screen` and only when speech is available:
- A Flag whose `start` falls inside an **ended** pause with `end − start ≤ thinkingPauseMaxMs` (4 s) is dropped. That is the "pause, glance, speech resumed" case.
- A Flag inside a still-**open** pause is dropped *for now*. It is re-evaluated on later ticks once the pause ends: if the pause was short it stays dropped; if it ran long, it counts.
- Use `isThinkingPause` and `inOpenPause` from `audio/speechActivity.ts`, moved into `rules/` (see M3) so `rules/` doesn't import from `audio/`.

**Tests (`gate.test.ts`).** Hand-built Flag arrays, no engine:
1. Before the Baseline → null.
2. Inside the grace window: a Flag at q.start+5 s held 20 s → null at every tick; a Flag at q.start+11 s held 7 s → hit.
3. Off-screen held 5.9 s → null; 6.0 s → hit `off-screen`. With speech unavailable: 7.9 s → null; 8.0 s → hit.
4. 2 glances in 60 s → null; 3 → hit; with speech unavailable, 3 → null and 4 → hit; 3 glances spread over 61 s → null.
5. A glance inside an ended 3 s pause doesn't count; inside an ended 5 s pause it does; inside an open pause it doesn't count yet.
6. Second face 2.9 s → null; 3 s → hit. Face missing 4.9 s → null; 5 s → hit.
7. A Flag that started before `watchFrom` is ignored even while still ongoing.
8. A dismissed Flag is ignored.
9. A Flag from the previous Question is ignored.
10. Priority: second face and off-screen both qualify → `second-face`.

### M2.3 Follow-up state machine (`rules/followUp.ts`, new)

A reducer: no side effects, returns what the controller must do.

```ts
export type FollowUpEvent =
  | { type: "question_started"; questionId: string; t: SessionTime }
  | { type: "gate_hit"; hit: GateHit; momentId: string; t: SessionTime }
  | { type: "ask"; t: SessionTime }
  | { type: "continue"; t: SessionTime }
  | { type: "dismiss"; t: SessionTime }
  | { type: "explore"; flagId: string; momentId: string; t: SessionTime }   // from Flag Details
  | { type: "tick"; t: SessionTime };

export type FollowUpEffect =
  | { type: "open_moment"; momentId: string; hit: GateHit | null; flagId?: string; followUpNumber: number; final: boolean }
  | { type: "moment_decision"; momentId: string; decision: Moment["decision"]; t: SessionTime }
  | { type: "moment_result"; momentId: string; result: "settled" | "persisting" }
  | { type: "timeline"; kind: TimelineKind; text: string; t: SessionTime };

export function initialFollowUp(questionId: string, t: SessionTime): FollowUpState;
export function reduceFollowUp(s: FollowUpState, e: FollowUpEvent): { state: FollowUpState; effects: FollowUpEffect[] };
/** Which events the UI may send in this phase (buttons render from this, so UI and logic can't drift). */
export function allowedActions(s: FollowUpState): ("ask" | "continue" | "dismiss" | "next_question")[];
```

**Transition table.** This is the authoritative version of ARCHITECTURE §3.3.

| From | Event | Guard | To | Effects |
|---|---|---|---|---|
| any | `question_started` | — | `observing`, used 0, watchFrom t, momentId null | timeline `question` |
| `observing` | `gate_hit` | used < MAX | `worth_exploring`, momentId | `open_moment` (n = used+1, final = used+1 === MAX), timeline `moment` |
| `observing` | `explore` | used < MAX | `worth_exploring` | `open_moment` with flagId, origin interviewer, timeline `moment` |
| `worth_exploring` | `ask` | used < MAX | `re_observing`, used+1, reObserveUntil t+30 s, watchFrom t | decision `asked`, timeline `follow-up-asked` "(n / 2)" |
| `worth_exploring` | `continue` | — | `observing`, watchFrom t, momentId null | decision `continued`, timeline `continued` |
| `worth_exploring` | `dismiss` | — | `dismissed` ■ | decision `dismissed`, timeline `dismissed` |
| `re_observing` | `gate_hit` | used < MAX | `persisting`, new momentId | result `persisting` on the asked Moment; `open_moment` (n = used+1, final), timeline `persisting` |
| `re_observing` | `gate_hit` | used = MAX | `limit_reached` ■ | result `persisting`, timeline `limit-reached` |
| `re_observing` | `tick` | t ≥ reObserveUntil | `settled` ■ | result `settled`, timeline `settled` |
| `persisting` | `ask` | used < MAX | `re_observing` (as above) | decision `asked`, timeline `follow-up-asked` |
| `persisting` | `continue` | — | `observing`, watchFrom t | decision `continued`, timeline `continued` |
| `persisting` | `dismiss` | — | `dismissed` ■ | decision `dismissed`, timeline `dismissed` |
| ■ terminal | anything but `question_started` | — | unchanged | none |
| any | event not in the table | — | unchanged | none (no throw; log in dev) |

**Invariants.** Unit-tested and also asserted in dev builds:
- `0 ≤ used ≤ MAX_FOLLOW_UPS`. The budget is enforced here, not in the UI (FR-015).
- `momentId !== null` exactly when the phase is `worth_exploring` or `persisting`.
- `reObserveUntil !== null` exactly when the phase is `re_observing`.
- Terminal phases (`settled`, `limit_reached`, `dismissed`) only leave on `question_started`.

**Tests (`followUp.test.ts`):**
1. The full happy path from PRD §21: observing → gate → worth_exploring → ask → re_observing → tick at +29.9 s (still re_observing) → tick at +30 s → settled. Effects and timeline text are checked exactly.
2. Persisting path: ask → hit at +10 s → persisting (Follow-up 2 / 2, `final: true`) → ask → hit → limit_reached.
3. A second ask after the limit is impossible: `allowedActions` is empty and the reducer ignores `ask`.
4. Continue moves `watchFrom`, so the same Flags can't re-open the Moment instantly.
5. Dismiss is terminal until the next Question.
6. A new Question from every phase resets to observing with used 0.
7. Property test with a seeded random event sequence (1,000 runs): the invariants always hold.

### M2.4 Scenario test (`rules/testing/scenarios.test.ts`, new)

This runs real `synthetic.ts` Signals through `RuleEngine` → store-like Flag list → `evaluateGate` → `reduceFollowUp`, ticking every 250 ms. It proves the loop end to end with no browser:

| Scenario | Expected |
|---|---|
| §21 step 1: 2 s glance during a 3 s pause, speech resumes | No Flag that passes the gate; phase stays `observing` |
| §21 steps 2–7: reading sweeps 20 s into Q2, then Ask, then steady gaze | `worth_exploring` → `re_observing` → `settled` |
| Reading continues after Ask | `persisting` → Ask → `limit_reached` |
| 25 min of natural conversation (existing generator) | **0** Moments (precision first, §18.5) |
| Same with speech unavailable | 0 Moments |

### Done when
All tests above pass, and the full suite runs in under 10 s.

---

## M3 — `audio/`: speech activity

**PRD:** FR-005A, §15 · **Size:** M · **Depends on:** M1

### Files
- `src/audio/speechActivity.ts`, which exists; finish it.
- Move the pure helpers `isThinkingPause` and `inOpenPause` to `src/rules/pauses.ts`, so `rules/` stays free of Web Audio and `audio/` only produces data.

### API (already written, keep)

```ts
class SpeechActivityDetector { push(t, rms): ActivityTransition | null; state }
function attachSpeechActivity(stream, getT, onChange): (() => void) | null   // null = no audio track
```

### Behaviour
- Energy (RMS) with an adaptive noise floor, 150 ms onset and 400 ms release hysteresis.
- No transcription, no model, no recording: samples are discarded after the RMS is computed.
- Never connected to `ctx.destination`, so there is no echo or playback.
- Uses `setInterval` rather than rAF, so it keeps running when the tab is in the background (the Interviewer is often looking at the meeting window).
- The controller turns transitions into a `Pause[]` ring. It keeps the last 120 s, with the open pause last.

### Source-by-source audio (document in README)
| Source | Audio | Notes |
|---|---|---|
| Local Webcam | Mic (echo cancellation + noise suppression) | Picks up both people in the room. That's acceptable: the gate only needs to know whether someone is talking, not who |
| Meeting window | Usually **none**. Chrome only shares audio for tabs, or for the whole screen on Windows with "Share system audio" | When there's no track → `unavailable` → stricter thresholds. Shown in the status bar |
| Local Video | From the file via `video.captureStream()` | Verify Chrome gives a live audio track while the element is muted; if not, use `createMediaElementSource` |

### Tests (`audio/speechActivity.test.ts`, new)
1. Silence at RMS 0.002 → stays `pause`.
2. A speech burst at 0.05 for 100 ms → no transition (below onset); for 200 ms → `speaking` with t = burst start.
3. While speaking, a 300 ms dip → stays speaking; a 500 ms dip → `pause` with t = dip start.
4. A slowly rising noise floor (fan noise) doesn't trigger speech.
5. NaN or negative RMS is treated as 0.
6. `isThinkingPause` and `inOpenPause` boundary cases (exactly 4,000 ms; pause ending at t).

### Done when
- The tests pass.
- With the webcam, the status bar shows `Speech context: on`, and it flips between speaking and pause when you talk. Check this by eye in the dev tools.

---

## M4 — `capture/` and `vision/`

**PRD:** FR-002, FR-003, §14A.2, §14A.5 · **Size:** M · **Depends on:** M1

### M4.1 `capture/source.ts`

Already done:
- `openWebcam()` with audio and a video-only fallback;
- `openWindowCapture()` with audio;
- `stopStream()`.

Add:

```ts
/** Local Video Source (FR-002, P1). Plays a file in the shared <video>; returns its stream for audio. */
export function openLocalVideo(video: HTMLVideoElement, file: File): Promise<{ stream: MediaStream | null; revoke: () => void }>;
export function hasAudio(stream: MediaStream | null): boolean;
```

- Local Video sets `video.src = URL.createObjectURL(file)`, with `loop = false`. The Session ends when the video's `ended` event fires.
- The object URL is revoked in `finish()`. Nothing is copied or uploaded.

### M4.2 `vision/`

- **Done:**
  - `faceTracker.ts`: vendored WASM and model, GPU → CPU fallback, `numFaces: 2`, transform matrices;
  - `signals.ts`: head pose plus iris → gaze, with tests;
  - `pipeline.ts`: `requestVideoFrameCallback`, crop, fps.
- **Add a sampling cap (§14A.2, §14A.5):** `VISION = { maxFps: 30, lightweightMaxFps: 10 }` in `rules/config.ts`. The pipeline skips frames closer together than `1000 / maxFps` ms.
  - Lightweight mode lowers the cap.
  - **Risk:** the reading rule needs a fast return (`returnMaxMs` 350 ms). At 10 fps that is about 3 samples. Add a synthetic test that runs the reading scenarios at 10 fps. If the hit rate falls below what's documented, the lightweight cap stays at 15 fps.
- **Add `setMaxFps(n)`** on `VisionPipeline`.
- **Add a dropped-frames counter** for the benchmark (frames offered vs frames analysed).

### Tests
- `signals.test.ts`: unchanged.
- `pipeline` has no unit test, since it's DOM-bound; it's covered by the manual run in §14.
- New `engine.test.ts` cases feeding Signals at 10, 15 and 30 fps to the reading and off-screen rules.

### Done when
- Webcam, window and local video all produce Signals.
- fps is shown.
- The rule tests pass at every sampling rate listed.

---

## M5 — `llm/`: local model, contract, guard, Moments

**PRD:** FR-011, FR-012, FR-013, §14A.1, §14A.3, §14A.5, §18.1, §28 · **Size:** L · **Depends on:** M1

### M5.1 `llm/ollama.ts` (half-edited; finish)

**Already there:**
- `MODEL_PREFERENCE = ["qwen3:4b", "qwen3:1.7b", "qwen2.5:3b"]`;
- `checkOllama()` selects the first installed;
- `stepDownModel()`, `chatJSON()` and `warmUp()`;
- `think: false` for Qwen3;
- `keep_alive: 30m`;
- temperature 0.

**Add:**
- **A per-call timeout:** `AbortSignal.any([signal, AbortSignal.timeout(LLM.timeoutMs)])`, with `LLM.timeoutMs = 20_000`.
- **Lightweight mode (§14A.5):** after any call, if `latencyMs > LLM.slowMs` (8,000) or the call timed out, call `stepDownModel()` once and report it through `onModelChange`. Never step back up during a Session.
- **Single flight:** only one request is in flight at a time, through a small module-level promise chain (§14A.4, "one local LLM at a time").
- **Getters** for the status bar: `currentModel()`, `lastLatencyMs()`, `isLightweight()`.

`LLM` config goes in `src/llm/config.ts`:
- `timeoutMs`;
- `slowMs`;
- `maxRetries: 1`.

### M5.2 Prompt contract (`llm/contract.ts`, new)

This implements PRD §28 exactly.

```ts
export interface ContractInput {
  question: string;                          // Question label, e.g. "Tell me about a difficult project"
  recent_flags: { type: "off_screen" | "reading_pattern" | "face_missing" | "second_face"; timestamp: string; description: string }[];
  follow_up_count: number;                   // used so far in this Question
  max_follow_ups: number;                    // MAX_FOLLOW_UPS
  gate_reason: string;                       // FR-011 "the reason the evidence gate was satisfied"
  final: boolean;                            // persisting → "one final follow-up"
}
export interface ContractOutput {
  moment_worth_exploring: boolean;           // §28; ignored for control flow (rules decide), kept for the record
  interviewer_note: string;
  follow_up: string;
  quality: { specific: boolean; neutral: boolean; grounded: boolean };
}
export function buildContractInput(session: Session, moment: Moment): ContractInput;
export const CONTRACT_SCHEMA: object;        // JSON schema passed as Ollama `format`
export const CONTRACT_SYSTEM: string;
```

**`recent_flags`:**
- the Moment's `flagIds` first;
- then up to 5 other Flags of the same Question from the last 60 s;
- `timestamp` is `m:ss`;
- `description` comes from `describeFlag()` in `notes.ts`, which is kept and holds only the formatting helpers.

**`question`:**
- if the label is the default "Question N", send `"(not labelled — a general interview question)"` and tell the model to keep the follow-up general;
- Q1 is sent as "Introduction".

**System prompt rules.** Short, imperative, and written with no banned words inside the prompt itself:
1. You write for the Interviewer, never the Candidate.
2. `interviewer_note`: at most 2 sentences; describe only what was observed and when; name the Question.
3. `follow_up`: one question, at most 25 words. It asks for personal specifics or reasoning about the **topic of the Question**. It never mentions eyes, gaze, the screen, reading, notes, other people or the camera (FR-012, "Were you reading something?" → no).
4. If `final` is true, the follow-up should invite a concrete example or a step-by-step account.
5. Never guess why something happened.

### M5.3 Guard (`llm/guard.ts`, new)

```ts
/** PRD §18.1 + §28 list. Matched as whole words, case-insensitive, with simple stems. */
export const BANNED = ["cheat", "cheating", "lie", "lying", "lied", "liar", "suspicious", "suspicion",
  "uncomfortable", "discomfort", "dishonest", "dishonesty", "deception", "deceptive", "deceive",
  "violation", "risk", "integrity", "nervous", "anxious"] as const;
/** Follow-ups must not point at the observation itself (FR-012). */
export const OBSERVATION_WORDS = ["look", "looking", "looked", "eye", "eyes", "gaze", "screen", "camera",
  "reading", "read", "notes", "someone", "anyone", "else in the room"] as const;

export function findBanned(text: string): string[];
export function checkQuality(out: ContractOutput, input: ContractInput): { specific: boolean; neutral: boolean; grounded: boolean; problems: string[] };
```

**The local check is authoritative (FR-013).** The model's own `quality` self-report is stored but never trusted.

| Check | Rule |
|---|---|
| `neutral` | No banned word in the note or follow-up, and no observation word in the follow-up |
| `specific` | The follow-up ends with "?", has 6–25 words, and contains one of: walk me through, example, specific, step, decide, decision, you personally, how did you, what did you |
| `grounded` | The note mentions the Question number or label, and the follow-up shares at least one content word (≥ 4 letters, not a stop word) with the Question label. For unlabelled Questions this is always true |

**Pass rule.** `neutral` must be true **and** the follow-up is non-empty.
- `specific` and `grounded` are shown as chips (P1) but don't force a retry.
- Exception: on retry, prefer the attempt with more true flags.

### M5.4 Moments writer (`llm/moments.ts`, new — replaces the 30 s note loop)

```ts
export interface Suggestion {
  note: string; followUp: string;
  quality: { specific: boolean; neutral: boolean; grounded: boolean };
  source: "llm" | "fallback";
  model: string | null; latencyMs: number | null;
}
/** Event-driven: called once per opened Moment. Never throws. */
export async function writeSuggestion(session: Session, moment: Moment, signal?: AbortSignal): Promise<Suggestion>;
export function fallbackSuggestion(session: Session, moment: Moment): Suggestion;
```

**Flow:**
1. `buildContractInput`.
2. `chatJSON`.
3. `checkQuality`.
4. If it fails, one retry. The retry appends to the user message: "Your previous answer was rejected because: {problems}. Write it again."
5. If it fails again, or on timeout or HTTP error → `fallbackSuggestion`.

**Fallback text** is deterministic and pre-checked by the language test.

| Kind | Interviewer Note |
|---|---|
| reading-pattern | "A reading-like gaze pattern was observed during Q{n} ({cycles} line sweeps)." |
| off-screen | "Gaze moved outside the usual range during Q{n} ({reason})." |
| face-missing | "The face was out of view for {s} s during Q{n}." |
| second-face | "A second face was visible for {s} s during Q{n}." |

| Follow-up slot | Question |
|---|---|
| 1 | "Could you walk me through what you personally did in that situation?" |
| 2 (final) | "Could you give me one specific example, step by step, of how you handled that?" |

`quality` is computed with `checkQuality`, so it stays honest.

### M5.5 Report (`llm/report.ts`)
Moved to M9, because it depends on the timeline.

### M5.6 Tests (`llm/llm.test.ts`, rewritten)

Mock `fetch`, as the current tests do.

1. `buildContractInput`:
   - gives exactly the §28 keys;
   - puts the Moment's Flags first;
   - caps at 6 Flags;
   - uses the unlabelled-question wording.
2. `chatJSON` sends `format`, `temperature: 0`, `keep_alive`, `think:false` for qwen3, and leaves `think` out for qwen2.5.
3. `findBanned`:
   - catches "Cheating", "lied." and "RISK";
   - ignores "earlier", "believe", "liability", "relied" and "lieutenant". This checks whole-word matching.
4. `checkQuality`:
   - "Were you reading something?" → neutral false;
   - "Could you walk me through how you scoped the project?" for "Tell me about a difficult project" → all true.
5. `writeSuggestion`:
   - good first answer → `llm`;
   - banned word then good → `llm` with 2 calls;
   - bad twice → `fallback`;
   - HTTP 500 → `fallback`;
   - timeout → `fallback`, and it never throws.
6. Step-down: a mocked latency of 9 s → the next call uses the next installed model.
7. Single flight: two concurrent calls → the second starts only after the first resolves.
8. The live Ollama test (`OLLAMA_LIVE=1`): three real Moments (reading, off-screen, second face) → every output passes `neutral`. Print the latency for BENCHMARK.md.

### Done when
- The tests pass.
- With Ollama stopped, the app still shows a suggestion: the fallback, within about 100 ms.

---

## M6 — `store/`: Session state

**PRD:** FR-007, FR-018 · **Size:** M · **Depends on:** M1

### File
`src/store/session.ts`

### `LiveState` additions

```ts
draft: { candidateName: string; consentAt: number } | null;   // set on Screen 1 Continue, before a Session exists
sourceReady: { kind: Session["source"]; hasAudio: boolean } | null;   // Screen 2 preview
speech: SpeechState;                      // "speaking" | "pause" | "unavailable"
llmModel: string | null; llmLatencyMs: number | null; lightweight: boolean;
baselineJustCompleted: boolean;           // drives the 1.5 s "Baseline ready ✓"
openFlagId: string | null;                // Flag Details overlay
```

The `screen` is **derived, not stored**, so it can't get out of sync:

```text
!draft && !session        → "consent"
draft && !session         → "source"
session && !baseline      → "baseline"   (Screen 3, shown over the video)
session && !endedAt       → "live"
session.endedAt           → "report"
```

### Actions (replace the note-based ones)

| Action | Effect |
|---|---|
| `confirmConsent(name)` | `draft = {name, consentAt: Date.now()}` (FR-001, consent recorded) |
| `startSession({source, speechAvailable, llmModel})` | Creates the Session with Q1 "Introduction", `followUp = initialFollowUp(q1, 0)`, and a timeline entry "Question started — Q1 Introduction". Clears `draft` |
| `nextQuestion(label?)` | Adds a Question; sends `question_started` through the reducer (via the controller, see M7) |
| `applyTransitions(trs)` | As today, plus `evidence` merging (start: set, end: merge `peakDeviationDeg`) and a timeline `flag` event on start: "Flag — Reading pattern (Q2)" |
| `applyFollowUp(state, effects)` | Sets `followUp`; applies `moment_decision`, `moment_result` and `timeline` effects |
| `openMoment(m)` / `updateMoment(id, patch)` | Moment lifecycle |
| `dismissFlag(id)` | `flag.dismissed = true` |
| `setSpeech(state)`, `setLlm(...)` | Status |
| `endSession()` | Closes open Flags; if the phase is `re_observing`, the asked Moment keeps `result: null` (reported as "Session ended during re-observation"); timeline `session-end` |
| `clearSession()` | Back to Screen 1 |

### Rules
- **Update discipline:** vision and audio write at up to 30 Hz, and React reads at 10 Hz through `emit()`. The timeline and Moments are append-only arrays, replaced immutably, so `useStore` selectors stay cheap.
- **Memory:** everything is in memory only; nothing goes to `localStorage` (PRD §16, "Stored: nothing until export").

### Tests (`store/session.test.ts`, new)
1. The screen derivation for each state.
2. A Flag's Question is the one active at its **start**, even when it ends in the next Question (FR-007).
3. End evidence merges into the right open Flag.
4. `endSession` closes open Flags and appends `session-end`.
5. `clearSession` resets every field.

### Done when
The typecheck is clean across the repo; this is the point where the build compiles again.

---

## M7 — `app/controller.ts`: wiring

**PRD:** §14 (data flow), FR-014, FR-016 · **Size:** M · **Depends on:** M2–M6

The controller owns every timer, stream and async call. React only calls its functions.

### API

```ts
export function preload(): void;                                // vision + Ollama check/select/warm-up + online listener
export function confirmConsent(candidateName: string): void;    // Screen 1
export async function openSource(kind: "window" | "webcam" | "video", file?: File): Promise<void>;  // Screen 2 preview
export function closeSource(): void;                            // back/cancel on Screen 2
export function startBaseline(): void;                          // Screen 2 → 3: Session + pipeline + speech
export function newQuestion(label?: string): void;              // N / button
export function followUpAction(a: "ask" | "continue" | "dismiss"): void;
export function exploreFlag(flagId: string): void;              // Flag Details → Explore
export function dismissFlag(flagId: string): void;              // Flag Details → Dismiss
export function setCrop(c: CropRect | null): void;              // exists
export function resetBaseline(): void;                          // exists
export async function finish(): Promise<void>;                  // End session → report
```

### Loop

```text
onFrame(signal) ─▶ engine.push ─▶ applyTransitions
every 250 ms (setInterval, keeps running in background tabs):
   now = sessionNow()
   reduce(tick)                                  → may settle re-observation
   if phase ∈ {observing, re_observing}:
      hit = evaluateGate({now, question, followUp, flags, baselineReady, speech})
      if hit → reduce(gate_hit) → effects
effects:
   open_moment → store.openMoment(skeleton: note=null, suggestion:"generating")
               → enqueue writeSuggestion(moment) → updateMoment(result)
   others      → store.applyFollowUp
speech onChange → pauses ring + store.setSpeech
```

### Details that matter
- **Ask before the suggestion is ready.** The buttons stay enabled while generating; the Interviewer is in control (FR-014). The card shows "Writing a suggestion…". If Ask is pressed, the text that arrives later is still stored on the Moment for the report.
- **Stale suggestions.** If the Question changes or the Moment is no longer current when the LLM returns, the Moment is still updated, but no UI state changes.
- **Session end:** abort the in-flight LLM call (`AbortController`), stop the interval, the pipeline, speech and the stream, then write the report (M9).
- **Track ended.** For window sharing stopped, or the local video ended → `finish()` (already done for the window).
- **Crop or Baseline reset mid-Question:** Flags end (already done). The gate gets `baselineReady = false` until it is re-learned, so it cannot fire.
- **Dev-only invariant check:** after each reduce, assert the M2.3 invariants and `console.error` on violation.

### Tests
- Covered by M2.4 (logic) plus the manual run in §14. No unit test for DOM wiring.
- Optional: `controller.test.ts` with fake timers and a fake pipeline that feeds the §21 synthetic Signals, asserting that the store ends in `settled`.

### Done when
The §14 manual run reaches every phase.

---

## M8 — `ui/`: screens and cards

**PRD:** §13 Screens 1–8, FR-001, FR-002, FR-004, FR-007 – FR-010, FR-014, FR-015, FR-017 · **Size:** L · **Depends on:** M6, M7

### Design rules for every screen
- An assistant, not surveillance (FR-008):
  - no red;
  - no meters or scores;
  - amber only for "ongoing";
  - emerald for local, ready or settled.
- Copy uses PRD §18.1 words only.
- Motion:
  - no animation on keyboard actions (N);
  - cards enter with a ≤ 200 ms ease-out fade plus a 4 px rise;
  - `prefers-reduced-motion` turns motion off.
- Every action is reachable by keyboard; overlays trap focus and close with Esc.

### M8.1 `App.tsx`
Switches on the derived `screen` (M6). The status bar is on every screen.

### M8.2 Screen 1: `ConsentScreen.tsx`
Split out from `SetupScreen.tsx`.

**Shows:**
- product name and tagline "Notice. Follow up. Know when to move on.";
- a 2-line on-device explanation;
- the privacy statement;
- the read-aloud script (existing `CONSENT_SCRIPT`);
- the Candidate name input;
- the checkbox "The Candidate has been informed and agreed";
- **Continue**.

**Behaviour:**
- Continue is disabled until the box is ticked. It calls `confirmConsent`.
- No camera is opened on this screen (FR-001: never infer consent from camera availability).

### M8.3 Screen 2: `SourceScreen.tsx`
**Shows:**
- three Source cards:
  - Online Interview / Assessment Window;
  - Local Webcam;
  - Local Video (P1; file picker, `accept="video/*"`);
- after choosing a Source: a live preview in `VideoPanel`, with the crop box available in window mode;
- the audio indicator: "Speech context available", or "No audio from this Source — stricter visual-only thresholds will be used";
- **Start Baseline**;
- Change Source.

**Behaviour:**
- Start Baseline is disabled until vision is ready and the preview is playing.
- Errors from permission denied or picker cancelled show inline in neutral wording, and the Interviewer stays on this screen.

### M8.4 Screen 3: Baseline
`BaselineOverlay` lives inside `VideoPanel`, which today shows a progress bar.

**Shows:**
- "Learning Candidate Baseline";
- the three bullets from FR-004 (Natural gaze range · Typical head direction · Normal movement);
- the progress bar;
- "● Processing locally";
- then "Baseline ready ✓" for 1.5 s, after which it fades to the Live Dashboard.

If no face is tracked for more than 5 s while learning, show the hint "Make sure one face is clearly visible".

### M8.5 Screen 4: `LiveScreen.tsx`
Layout per PRD §13 Screen 4.

**Left column:**
- the video;
- the diagnostics strip (`SignalReadout`), collapsed by default (P1 diagnostics).

**Right column:**
- **Current Question:**
  - "Q2 · label";
  - the Question clock and the Session clock;
  - a label input;
  - "+ New Question (N)".
- The **Follow-up card** area (M8.6). It is pinned at the top of the right column when not `observing`, so it never moves while the Interviewer is reading.
- **Recent:**
  - mixed Flags and Moments, newest first;
  - each row: time · label · Q · duration; ongoing rows have a soft amber dot;
  - clicking a Flag row → Flag Details.
- **Reset baseline**, **End session**.

**Header:** "● Processing locally" plus the status bar.

**Remove:** `NotesPanel` and the "every 30s" copy. Notes now live on Moments.

### M8.6 Card 6/7: `FollowUpCard.tsx` (new)

Renders from `followUp.phase` plus the current Moment. Buttons come from `allowedActions()`.

| Phase | Title | Body | Buttons |
|---|---|---|---|
| `observing` | (hidden) | — | — |
| `worth_exploring` | Moment worth exploring | Gate reason · Interviewer Note (or "Writing a suggestion…") · "Suggested follow-up: “…”" · quality chips (P1) · source tag ("local LLM · qwen…" or "template") | **Ask Follow-up** · Continue · Dismiss |
| `re_observing` | Re-observing… | "Follow-up n / 2 asked. Watching for 30 s." · thin progress line (linear) | — |
| `settled` | Observation settled ✓ | No further follow-up suggested. | **Next Question** |
| `persisting` | Pattern continues | One final follow-up is available. · suggestion as above | **Ask final follow-up** · Continue · Dismiss |
| `limit_reached` | Follow-up limit reached | The assistant will stop suggesting follow-ups for this Question. | **Next Question** |
| `dismissed` | (collapsed line) | Suggestions paused for this Question. | — |

- The counter "Follow-up n / 2" appears in `worth_exploring`, `re_observing` and `persisting` (FR-015). It shows the slot the next Ask would use: `used + 1` before asking, and `used` while re-observing.
- Next Question here equals pressing N.

### M8.7 Overlay 5: `FlagDetails.tsx` (new)

Uses a pure helper `ui/explain.ts`: `explainFlag(flag, now) → { title, observation, baseline, observed, threshold }`. Example for off-screen (FR-009):

```text
LOOKING OFF-SCREEN · 0:42 · 4 s
The Candidate's gaze moved outside their usual gaze range for about 4 seconds.
Baseline:  normal gaze slightly below centre (±3.1° × ±2.4°)
Observed:  gaze moved to the right, up to 18° from centre
Threshold: 10° sideways / 10° vertical
This is an observation, not a conclusion.
[ Dismiss ]  [ Explore ]
```

| Action | Effect |
|---|---|
| **Dismiss** | `dismissFlag`: the row is greyed and excluded from the gate |
| **Explore** | `exploreFlag`: opens a Moment from this Flag. Only enabled when the phase is `observing` and the budget is left, with a tooltip explaining why not otherwise |

**Tests (`ui/explain.test.ts`):** one case per Flag kind; the output contains no banned words and has a duration.

### M8.8 `StatusBar.tsx`
Add these pills:
- `Speech context: on` / `Speech context unavailable`;
- the model name (e.g. `qwen2.5:3b`) and the last latency;
- `Lightweight mode` when stepped down.

Keep the existing pills: vision GPU/CPU, fps, LLM state, online/offline.

### Done when
- Every SITEMAP element exists.
- The §14 manual run passes.
- Keyboard-only use works.
- Light/dark contrast passes.
- Nothing is red.

---

## M9 — Session Timeline and Session Report

**PRD:** FR-018, FR-019 (P1), FR-020 · **Size:** M · **Depends on:** M5, M6

### M9.1 `llm/report.ts` (rewrite on Moments and timeline)

**Question Journey.** A deterministic structure first, then the LLM only writes the summary sentences:

```ts
export interface QuestionJourney {
  question: Question;
  flags: Flag[];
  moments: Moment[];                       // in order
  followUpsAsked: { text: string; at: SessionTime; n: number }[];
  outcome: "none" | "observed" | "continued" | "dismissed" | "settled" | "persisting" | "limit_reached" | "unresolved";
}
export function buildJourneys(session: Session): QuestionJourney[];
```

`outcome` is the Question's final follow-up phase:
- `none` = no Flags;
- `observed` = Flags but no Moment;
- `unresolved` = the Session ended while re-observing.

**LLM report:**
- the input is the journeys as text (no video, no landmarks);
- the output schema is `{summary, perQuestion[{questionNumber, observation}]}`.

**Follow-ups in the report.** These are the ones the Interviewer **actually asked**, taken from the Moments. The report LLM never invents new ones; that keeps the report grounded. This changes the current behaviour, where the report LLM suggests follow-ups.

**Guard.** The same `findBanned` check applies. Any field that fails falls back to the deterministic text for that field.

`fallbackReport` is rewritten on journeys, with the same shape.

### M9.2 `ReportScreen.tsx`

**Sections (PRD §13 Screen 8):**
1. **Session summary:** Candidate, date, consent time, Source, length, speech context on/off, model used, lightweight yes/no.
2. **Summary paragraph** (LLM or fallback, labelled with which).
3. **Per Question:**
   - Q · label · start;
   - the Question Journey line `Question → Moment explored → Follow-up → Result` (P1 visual; P0 as text);
   - Flags.
4. **Totals:** Moments explored · follow-ups used · settled · persisting / limit reached · unresolved (PRD §13 Screen 8 lists).
5. **Session Timeline:** every event, `m:ss` plus text.
6. **Export PDF** (primary) · Export Markdown · Export JSON · New session.
7. **Privacy footer:** "Generated on-device. No video or images were stored or transmitted."

**Never shown:** images, scores, hiring recommendations (FR-020, FR-021).

### M9.3 `toMarkdown` / `toJSON`
Updated to the same sections. The JSON is the full Session minus nothing (it holds no images by construction).

### Tests
1. `buildJourneys` gives the right outcome for each phase path (reuse M2.3 event sequences).
2. The report never contains a follow-up that wasn't asked.
3. A banned word in the LLM summary → that field falls back.
4. Markdown contains every Question, the timeline and the footer.

### Done when
A Session from the §14 run produces a report that reads like the PRD FR-020 example.

---

## M10 — PDF export

**PRD:** FR-021 · **Size:** S–M · **Depends on:** M9

**Decision: the browser's print to PDF**, with no new dependency.
- It works offline.
- The text stays selectable.
- The Chrome and Edge "Save as PDF" destination is built in.

### Files
- `src/ui/print.css`, or `@media print` rules in `index.css`.
- `exportPdf()` in `ui/ReportScreen.tsx`.

### Behaviour
1. **Export PDF:**
   - set `document.title = "{candidate}-{date}-session-report"` (Chrome uses it as the file name);
   - call `window.print()`;
   - restore the title on `afterprint`.
2. **Print styles:**
   - hide the header, status bar and buttons;
   - white background, black text;
   - A4 margins 16 mm;
   - `break-inside: avoid` on each Question block;
   - page numbers via `@page { @bottom-right { content: counter(page) } }` where supported.
3. The order prioritises Questions, observations, follow-ups, outcomes and timestamps (FR-021).

### Done when
Exporting a 5-Question Session gives a clean 1–3 page PDF with Wi-Fi off. Check by eye.

**Fallback if print layout fights us:** add `jspdf` text-only export. It is +1 dependency, vendored by npm, with no CDN.

---

## M11 — Benchmark, disclosures, offline readiness

**PRD:** §14A.6, §14A.7, §20, §25 "Reference-hardware benchmark" · **Size:** M · **Depends on:** M4, M5, M7

### M11.1 `scripts/bench-llm.mjs` (new)
For each installed model in `MODEL_PREFERENCE`:
1. a cold load;
2. then 5 calls with the real `CONTRACT_SYSTEM` and three fixed §28 inputs.

It records:
- load time;
- p50/p95 latency;
- the guard pass rate;
- RAM/VRAM, read from `ollama ps`.

Output is a Markdown table on stdout.

### M11.2 Diagnostics panel (P1)
A collapsed panel in Live. It shows:
- fps (offered/analysed);
- dropped frames;
- vision delegate;
- last LLM latency;
- gate-to-suggestion latency (Moment `t` → suggestion ready).

**Copy diagnostics** puts them on the clipboard as Markdown for BENCHMARK.md.

### M11.3 `docs/BENCHMARK.md` (new)
Fill only with measured numbers on the tested machine (PRD Appendix A):
- i5-13420H;
- RTX 3050 4 GB;
- 7.7 GB RAM.

These §14A.6 rows:
1. vision only;
2. vision plus dashboard;
3. vision plus LLM;
4. full pipeline (pattern → follow-up latency);
5. lightweight fallback;
6. offline mode (pass/fail).

### M11.4 README
- Run steps.
- Requirements.
- `ollama pull` lines.
- The "Why local AI" section.
- Disclosures:
  - models;
  - frameworks (React, Vite, Tailwind, MediaPipe Tasks Vision, Ollama);
  - APIs (none at runtime for the core loop);
  - AI dev tools used;
  - tested hardware;
  - the Source audio table from M3.
- The offline-test steps (PRD §20).

### M11.5 Offline checklist (scripted where possible)
- `npm run build && npm run preview`, then turn Wi-Fi off.
- Load the app, go through Webcam, Baseline, Flag, Moment and Ask, until it settles.
- In DevTools → Network: only `localhost` requests.
- `scripts/fetch-assets.mjs` has already vendored the WASM and model. Verify that `public/` contains them, so there's no CDN at runtime.

### Done when
- BENCHMARK.md has real numbers.
- The README disclosures are complete.
- The offline checklist passes on the demo laptop.

---

## M12 — `landing/`: Landing Site

**Spec:** PRD-landing-page.md, SITEMAP §1 · **Size:** M · **Depends on:** nothing (fully separate)

### Structure

```text
landing/
├── package.json        (vite, tailwindcss, @tailwindcss/vite — its own deps, no import from ../src)
├── vite.config.ts
├── index.html          single page, sections in SITEMAP §1 order
├── src/style.css       Tailwind + tokens (light/dark via prefers-color-scheme)
├── src/main.ts         tiny: smooth-scroll for anchors only (or none)
└── public/
    ├── og.png          1200×630 social preview (LP-008)
    ├── architecture.svg
    └── favicon.svg
```

### Sections (each maps to a PRD-landing-page §4 row)
1. **#hero:**
   - name;
   - "Notice. Follow up. Know when to move on.";
   - the one-line pitch;
   - CTAs: Watch demo · View on GitHub · Run it locally.
2. **#problem:** three short lines.
3. **#how-it-works:**
   - five steps: Observe → Explore → Re-observe → Resolve → Move On;
   - a static HTML/CSS copy of the Follow-up card ("Follow-up 1 / 2", Ask / Continue). No screenshot of a real person.
4. **#not:**
   - the "What it is not" list;
   - the only place the avoided words may appear, and only to say what it does **not** do.
5. **#why-local:** privacy, real time, the core AI loop works without cloud AI, plus the two required statements.
6. **#demo:** the video embed or link. The URL is a constant at the top of `index.html`, and the section shows "Demo video coming soon" until it is set.
7. **#architecture:** a simplified SVG of ARCHITECTURE §1–2.
8. **#run:** requirements, 4 commands, a link to the README.
9. **#disclosures:** models, frameworks, APIs, AI tools, tested hardware.
10. **Footer:** GitHub · demo · X/LinkedIn · #AppBuildersPH · MIT.

### Rules (LP-001 – LP-008)
- No analytics, cookies, forms or third-party fonts. System font stack.
- Responsive at 360, 768 and 1440 px with no horizontal scroll.
- Visible focus.
- Reduced motion respected.
- Contrast AA.

### Deploy
- Vercel project with root directory `landing/`, build `npm run build`, output `dist/`.
- Root `package.json` gets `"landing:dev"` and `"landing:build"` scripts that `cd landing`.

### Done when
The PRD-landing-page §8 acceptance checklist is all ticked.

---

## 13. Cross-cutting

### 13.1 Config single source
- `src/rules/config.ts` holds `RULES` (including `followUp`) and `VISION`.
- `src/llm/config.ts` holds `LLM`.
- `src/audio/speechActivity.ts` holds `SPEECH`.

Docs quote these; code never hard-codes them elsewhere.

### 13.2 Time
- All in-Session times are ms since Session start (`SessionTime`).
- Wall-clock (`Date.now()`) is only for `consentAt`, `startedAt` and `endedAt`.
- Formatting uses `formatTime` (m:ss), which is used everywhere, including the timeline and PDF.

### 13.3 Language test (`src/language.test.ts`, new)
- Reads every `src/**/*.{ts,tsx}` file except `llm/guard.ts` and test files.
- Extracts string and template literals plus JSX text.
- Fails if `findBanned()` returns anything.

It also runs over:
- `fallbackSuggestion` for every Flag kind and slot;
- `fallbackReport` on a sample Session;
- `explainFlag` for every kind.

### 13.4 Privacy checks
- A test asserts that `toJSON(session)` contains no `data:image` or `blob:` strings.
- The code-review rule: no `fetch` other than `OLLAMA_BASE`. Enforced by a grep in the language test: only `llm/ollama.ts` may call `fetch(`.

### 13.5 Commits
Commit one module at a time in the order of §1, for example:
- "Rules: evidence gate and follow-up state machine (FR-010, FR-014–017)";
- "LLM: §28 contract, guard, event-driven suggestions (FR-011–013)".

---

## 14. End-to-end manual run (demo rehearsal)

Run this on the demo laptop, using the webcam. It mirrors PRD §21 and §20.

| # | Do | Expect |
|---|---|---|
| 1 | Open the app | Screen 1. Status: Vision on GPU, Local LLM ready (model), Online |
| 2 | Enter a name, tick Consent, Continue | Screen 2. No camera opened before this |
| 3 | Local Webcam | Preview. "Speech context available" |
| 4 | Start Baseline, look at the screen ~15 s | Screen 3 progress → "Baseline ready ✓" → Live |
| 5 | N, label "Tell me about a difficult project" | Q2 shown. Card hidden |
| 6 | Within 10 s, look away 8 s | A Flag may appear in Recent. **No Moment** (grace) |
| 7 | Talk, pause 2 s, glance away, resume talking | No Moment (thinking pause) |
| 8 | Read a paragraph off a second window, ~10 s | Reading Flag → "Moment worth exploring", Note and follow-up within the measured latency, Follow-up 1 / 2 |
| 9 | Click the Flag row | Flag Details with baseline vs observed. Esc closes |
| 10 | Ask Follow-up, then look at the screen 30 s | Re-observing… → "Observation settled ✓". Next Question |
| 11 | N, then repeat step 8 → Ask → read again | Pattern continues → Ask final follow-up → read again → Follow-up limit reached |
| 12 | N, then step 8 → Dismiss | Nothing more this Question |
| 13 | Turn Wi-Fi off, repeat steps 8 and 10 | Same behaviour. Status shows Offline |
| 14 | Stop Ollama, repeat step 8 | Template suggestion immediately; status "Local LLM unavailable" |
| 15 | End session | Report: journeys, Flags, timeline, totals, footer |
| 16 | Export PDF (Wi-Fi off) | Clean PDF, no images |
| 17 | New session | Screen 1, empty state |

**Window-mode check:** run steps 2–10 once with a Meet test call and the crop box. Expect "Speech context unavailable" and the stricter thresholds.

---

## 15. Scope protection and cut lines

When time runs short, cut from the bottom of this list, never the core loop (PRD §19).

| Cut order | Item | Priority | Effect if cut |
|---|---|---|---|
| 1 | Local Video Source | P1 | Use the webcam for the offline test (PRD §20 allows it) |
| 2 | Question Journey visual (keep the text line) | P1 | Report still per Question |
| 3 | Quality chips in the card (keep the guard itself) | P1 | FR-013 enforced, just not shown |
| 4 | Diagnostics panel | P1 | Benchmark via `bench-llm.mjs` plus the fps pill |
| 5 | Lightweight vision fps cap | P1 | LLM step-down still exists |
| 6 | Flag Details → Explore (keep the overlay plus Dismiss) | — | FR-009 still met |
| 7 | Landing site polish (keep hero, how-it-works, run, disclosures) | — | Still meets LP-001–004 |

**Never cut** (P0, demo-critical):
- Consent;
- Source;
- Baseline;
- Flags;
- the evidence gate;
- the state machine with the 2-follow-up limit;
- the §28 LLM with guard and fallback;
- the Follow-up card;
- re-observation and settled;
- the timeline;
- the report;
- PDF;
- the offline run.

---

## 16. Traceability: PRD → module → proof

| PRD | Module(s) | Proven by |
|---|---|---|
| FR-001 Consent | M6, M8.2 | §14 steps 1–2; store test (consentAt set before Session) |
| FR-002 Source | M4.1, M8.3 | §14 step 3 + window-mode check |
| FR-003 Vision | M4.2 | `signals.test.ts`; fps pill |
| FR-004 Baseline | M2.1, M8.4 | `engine.test.ts` baseline cases; §14 step 4 |
| FR-005 Temporal | M2.1, M2.2 | `gate.test.ts` 2–5; scenario "natural conversation → 0 Moments" |
| FR-005A Speech | M3, M2.2 | `speechActivity.test.ts`; gate cases 3–5 |
| FR-006 Flags | M2.1 | `engine.test.ts` |
| FR-007 Questions | M6, M8.5 | store test 2; §14 step 5 |
| FR-008 Dashboard | M8.5 | §14; design rules |
| FR-009 Explainable | M2.1 evidence, M8.7 | `explain.test.ts`; §14 step 9 |
| FR-010 Moment | M2.2, M2.3, M8.6 | `gate.test.ts`, scenario test |
| FR-011 Note | M5.2, M5.4 | `llm.test.ts` 1, 5; live test |
| FR-012 Follow-up | M5.2–M5.4 | `checkQuality` tests; live test |
| FR-013 Quality (P1) | M5.3, M8.6 | `llm.test.ts` 4 |
| FR-014 Override | M2.3, M8.6 | `followUp.test.ts` 4–5 |
| FR-015 Counter | M2.3, M8.6 | `followUp.test.ts` 2–3; invariant property test |
| FR-016 Re-observation | M2.3, M7 | `followUp.test.ts` 1 |
| FR-017 Stop | M2.3 | `followUp.test.ts` 1–2 |
| FR-018 Timeline | M2.3 effects, M6, M9 | store and report tests |
| FR-019 Journey (P1) | M9.1, M9.2 | `buildJourneys` test |
| FR-020 Report | M9 | report tests; §14 step 15 |
| FR-021 PDF | M10 | §14 step 16 |
| §14A model selection | M5.1 | `llm.test.ts` 6 |
| §14A.6 Benchmark | M11 | BENCHMARK.md |
| §18.1 Language | M5.3, §13.3 | language test |
| §20 Offline | M11.5 | §14 step 13 |
| Landing | M12 | PRD-landing-page §8 |

---

## 17. Open decisions

Each has a recommendation. Decide before the module starts.

| # | Decision | Recommended | Module |
|---|---|---|---|
| D1 | Keep or revert the uncommitted half-edits | **Keep and finish** (they match the docs) | Step 0 |
| D2 | Flag Details → Dismiss removes the Flag from the gate only, or also hides it from Recent | Gate only; row greyed, still listed (nothing silently disappears) | M8.7 |
| D3 | Flag Details → Explore can open a Moment without the gate | Yes, when observing and budget remains (Interviewer in control, FR-014) | M2.3 |
| D4 | PDF via print or `jspdf` | Print (no dependency, offline) | M10 |
| D5 | Should an off-screen Flag that started before `watchFrom` but is still ongoing count during re-observation? | No (as in ARCHITECTURE §3.2); revisit only if the demo shows a miss | M2.2 |
| D6 | Report LLM writes new follow-ups or lists only asked ones | Only asked ones (grounded) | M9.1 |
