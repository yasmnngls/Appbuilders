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

**Eligible Flags** (revised by the audit, §18.4). The gate's *floor* is the later of `question.start + graceMs` and `followUp.watchFrom`. A Flag counts if it is not `dismissed` and either:
- it belongs to this Question and starts at or after the floor; or
- it is **still running at the floor** (started earlier, even in the previous Question or before an Ask). It then counts only for the time after the floor. Exception: after **Continue**, Flags already running are excluded, because the Interviewer has already seen them.

A carried-over Flag never counts as a new glance toward the repeat trigger. A carried-over reading Flag must keep going for `reading.windowMs` past the floor. Ownership never changes: a Flag still belongs to the Question active when it started (FR-007).

**Never open (returns null):**
- gaze triggers (off-screen, reading) while the Baseline isn't ready. Face triggers (face missing, second face) work without a Baseline;
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
| D5 | Should a Flag that started before `watchFrom` but is still ongoing count during re-observation? | **Resolved by the audit: yes**, for the time after the Ask; otherwise a pattern that never stops reads as "settled" (FR-016) | M2.2 |
| D6 | Report LLM writes new follow-ups or lists only asked ones | Only asked ones (grounded) | M9.1 |

---

# Full Audit Results

| | |
|---|---|
| Date/time | 2026-10-10, 03:00–03:56 (UTC+8) |
| Commit tested | `20459db` (start) → fixes through `0efde50` (end) |
| Test suite at end | `npx tsc --noEmit` clean · `npx vitest run`: 14 files, **332 passed**, 1 skipped (live-LLM suite, opt-in with `OLLAMA_LIVE=1`) |
| Environment | Windows 11 (26200), Node 24.18, Vite 8, Edge 154 headless (puppeteer-core, fake camera/mic), Ollama 0.40.1 |
| Hardware | ASUS Vivobook K3605VC: i5-13420H, **RTX 3050 Laptop 4 GB**, **7.7 GB RAM**. This is *not* the PRD §14A.4 reference machine (RTX 4060 / 8 GB); every number below is from this laptop |
| Method | Four parallel audits (rules, flow/security/storage, local LLM, audio/sources/offline/benchmark). Each claim was proven by a test, a browser run, or a code trace. Anything not proven is marked NOT VERIFIED or PENDING MANUAL RUN |

**The biggest limit of this audit: no real face was used.** The headless fake camera shows no face, so the full camera → MediaPipe → Signals → Baseline path was driven with synthetic Signals (unit/scenario tests) or synthetic Flags (browser). The vision model itself ran in the browser (fps and latency measured), but whether real gaze produces the right Signals on this laptop is **PENDING MANUAL RUN**.

## Hackathon criteria

| Criterion | Already satisfied | Weak points / what a judge could question | Fix | Status |
|---|---|---|---|---|
| Problem & Usefulness (25%) | One user (Interviewer), a clear problem (PRD §3), an assistant that suggests and then stops (2-follow-up limit, settled/limit states), never scores | Usefulness depends on real gaze accuracy, which is not yet verified with a real face. Window mode (the realistic online-interview case) has no audio, so it uses the stricter visual-only rules | Real-face rehearsal (§14 run) before recording the demo | PARTIAL |
| Local AI Implementation (25%) | Vision runs in the browser (MediaPipe Face Landmarker, WASM + GPU delegate, vendored model, no CDN). The LLM is local (Ollama, qwen2.5:3b Q4_K_M). Speech activity is local. **0 requests outside localhost** in a simulated offline run, after blocking MediaPipe's built-in telemetry. The LLM is fundamental: it writes every Note and follow-up | PRD §14A.1 targets ONNX Runtime + WebGPU and Qwen3 4B/1.7B; we use MediaPipe's runtime (WebGL GPU delegate) and qwen2.5:3b, the only installed model. Real Wi-Fi-off run not done | Disclose the actual stack (README does). Optionally `ollama pull qwen3:4b` and `ollama pull qwen3:1.7b` and re-benchmark. Do the real Wi-Fi-off run | PARTIAL (simulated offline PASS) |
| Technical Execution (20%) | Pure, tested rules engine (Baseline, 4 Flags, evidence gate, state machine with invariants and a property test). 332 tests. Guard with retry and fallback. Consent enforced in code. Consistency checker over a 20-Question session. 5-minute stability run with no heap growth | No real-face end-to-end run. LLM latency 5–12 s on a shared GPU (one call hit the 20 s budget and fell back) | Manual run. Warm the model before the demo (the app does it on load) | PARTIAL |
| Innovation (15%) | The bounded loop Observe → Explore → Re-observe → Resolve → Move On; precision first; a dead-air filter driven by speech activity; Flags explained against a personal Baseline | Could be read as "eye tracking with an LLM" if the demo doesn't show the *stop* behaviour | Demo must show both settled and limit reached (§14 steps 10–11) | PASS (design) |
| Product & Demo Quality (15%) | Calm, non-surveillance UI; all screens verified in the browser; landing site built | Demo video not recorded. Landing links are placeholders and the site isn't deployed. Real-face demo not rehearsed | See the pre-submission checklist | NOT VERIFIED |

**Local AI statements we can defend:**
- Meaningful inference is local: per-frame vision, and the LLM writing Notes and follow-ups.
- The core loop works with no cloud AI.
- **Online interview:** the meeting platform needs internet; our AI layer doesn't.
- **Offline Test:** use Local Webcam or Local Video, then disable internet.

## Requirements Coverage

Status key:
- **PASS** = functionally verified.
- **PARTIAL** = verified with synthetic input only, or partly.
- **NOT VERIFIED** = built but not exercised.
- **MISSING** = not built.

| Requirement | PRD | Implemented | Tested | Evidence | Status |
|---|---|---|---|---|---|
| Consent gate | FR-001 | Yes; enforced in UI, controller and store | Browser + unit | Bypass via module API closed (`controller.test.ts`, `consistency.test.ts`) | PASS |
| Consent from platform | FR-001 opt. 1 | No | — | No connector or postMessage hook | MISSING (documented limitation) |
| Source: webcam | FR-002 | Yes | Browser (fake cam) | Preview, permission-denied and no-camera messages | PASS |
| Source: meeting window + crop | FR-002 | Yes | Headless "entire screen" only | Single real meeting window not tested | NOT VERIFIED |
| Source: Local Video | FR-002 (P1) | Yes | Browser | Generated webm: plays, Signals 21–25 fps, `ended` → finish, bad file → message | PASS |
| Local vision Signals | FR-003 | Yes | Unit + browser fps | Real-face accuracy untested | PARTIAL |
| Automatic Baseline | FR-004 | Yes | Unit + browser (synthetic) | 15 s median/MAD; real face PENDING | PARTIAL |
| Temporal processing / gate | FR-005 | Yes | 27 audit tests on the real engine | PRD cases 1–9 pass; 4 false negatives fixed | PASS (synthetic) |
| Speech activity | FR-005A | Yes (energy VAD) | Unit + browser (tone) | Transitions verified; real voice PENDING | PARTIAL |
| 4 Flag types | FR-006 | Yes | Unit | `engine.test.ts`, `audit.test.ts` | PASS (synthetic) |
| Question tracking | FR-007 | Yes | Unit + browser | Ownership at Flag start; label capped at 200 chars | PASS |
| Live dashboard | FR-008 | Yes | Browser | Screenshots; no red, no scores | PASS |
| Explainable Flag | FR-009 | Yes | Unit + browser | `explain.test.ts`; Esc closes | PASS |
| Moment worth exploring | FR-010 | Yes | Unit + browser | Gate → card | PASS |
| Local Interviewer Note | FR-011 | Yes | Live LLM ×22 | Event-driven; 20 s budget; fallback | PASS |
| Neutral follow-up | FR-012 | Yes | Live + guard tests | 22 live runs; injections rejected | PASS |
| Quality check | FR-013 (P1) | Yes (local, authoritative) | Unit + live | Chips shown | PASS |
| Interviewer override | FR-014 | Yes | Unit + browser | Ask/Continue/Dismiss/Explore | PASS |
| Follow-up counter / limit | FR-015 | Yes, in the reducer | Unit + browser (API ×5) | `used` never above 2 | PASS |
| Re-observation | FR-016 | Yes | Unit + browser | 30 s; the "pattern never stopped" loophole is fixed | PASS |
| Stop condition | FR-017 | Yes | Unit + browser | settled / limit_reached | PASS |
| Session Timeline | FR-018 | Yes | Consistency test | One event per transition | PASS |
| Question Journey | FR-019 (P1) | Yes | Unit | `buildJourneys` | PASS |
| Session Report | FR-020 | Yes | Browser + unit | LLM about 13–16 s; fallback; grounding check | PASS |
| PDF export | FR-021 | Yes (print) | Browser (print stubbed) | Real "Save as PDF" output PENDING | PARTIAL |
| Markdown / JSON export | — | Yes | Unit (content) | Files on disk not checked headless | PARTIAL |
| Model selection / step-down | §14A.5 | Yes | Unit | Qwen3 not installed, so not exercised on hardware | PARTIAL |
| Benchmark | §14A.6 | Partly | Browser + bench script | BENCHMARK.md; real-face, RTX-GPU vision and Wi-Fi-off rows PENDING | PARTIAL |
| Offline core loop | §20 | Yes | Simulated (dead proxy) | 0 external requests; LLM and report work | PARTIAL (real Wi-Fi-off PENDING) |
| Observation-only language | §18.1 | Yes | `language.test.ts`, guard tests | Scans all source plus fallbacks | PASS |
| Landing site | PRD-landing | Yes | Headless 360/768/1440 | Links placeholder; not deployed | PARTIAL |

## Bugs Found

| # | Symptom | Root cause | Fix | Regression test |
|---|---|---|---|---|
| B1 | MediaPipe POSTed usage stats to `odml.pa.googleapis.com` every 60 s (no frames or landmarks, but it contradicts "no cloud") | Built-in logger in `@mediapipe/tasks-vision` 1.1.0 | `faceTracker.ts` refuses fetch to that host. A CSP `connect-src 'self'` in `index.html` blocks any future third-party call | `faceTracker.test.ts`; browser: 0 external requests |
| B2 | Camera could open and a Session start without Consent (module API) | No check for the Consent draft in `openSource` / `startSession` | Throws or returns `false` without a draft | `controller.test.ts`, `consistency.test.ts` |
| B3 | "Observation settled" while the Candidate looked away through the whole re-observation | The gate ignored Flags that started before the Ask | Running Flags count after the floor | `audit.test.ts` "gaze kept away…", `gate.test.ts` 7b |
| B4 | Reading or face pattern that started in the 10 s grace window never opened a Moment | Same: start-time-only eligibility | Same fix | `audit.test.ts` grace cases, `gate.test.ts` 2 |
| B5 | A Flag running across a Question boundary was invisible in the new Question | `questionId` filter | Counts from the new Question's grace end; ownership unchanged | `gate.test.ts` 7c |
| B6 | Face missing or second face could not open a Moment before or while relearning the Baseline | Gate required the Baseline for every trigger | Only gaze triggers require it | `gate.test.ts` 1b |
| B7 | `exploreFlag` with an unknown, dismissed or earlier-Question Flag opened a phantom Moment | No validation | Validate Flag, status and Question | `controller.test.ts` |
| B8 | New session left the old report's LLM request running | No abort | `newSession()` aborts and closes the Source | Browser |
| B9 | A Moment could show "generating…" for up to about 100 s | Timeout started after the queue wait; retry added more | 20 s total budget, also while queued | `llm.test.ts` budget test |
| B10 | The report could invent an unobserved Flag kind ("face out of view") | The guard checked words only | A field naming an unobserved kind falls back | `llm.test.ts` kind-grounding |
| B11 | Notes copied "(the project question)" onto unrelated Questions | The model copied the prompt example | `stripUngroundedTopic` | `llm.test.ts` |
| B12 | Report said "session ended" for a Question left mid re-observation | Single outcome text | "Re-observation did not finish before the Question ended." | Report tests |
| B13 | Smoke-test bugs: Source stopping before preview hung Screen 2; "Baseline ready" pill stuck; export names in UTC; fps shown after session end | — | Fixed (`cd035d6`, `6e82237`, `0efde50`) | Browser |

## Loopholes Found

| Exploit / path | Impact | Fix | Verification |
|---|---|---|---|
| Call `openSource` / `startBaseline` without Consent | Observation without Consent (FR-001) | B2 | Browser: no stream, no Session |
| Keep looking away from before the Ask until re-observation ends | System reports "settled"; the loop is defeated | B3 | Audit tests |
| Start reading as the Question is asked | No Moment for that Question | B4 | Audit tests |
| `followUpAction("ask")` ×5 via the API | Exceed 2 follow-ups | Already blocked by the reducer | Browser + property test (1,000 runs) |
| Prompt injection through the Question label (instructions to accuse, fake JSON, chat-template tokens) | Accusatory text shown | Label flattened, JSON-quoted, clipped to 200 chars; phrase-level guard; retry → fallback | 22 live runs: nothing banned shown |
| 10,000-character label or name | Bloated prompt/report | Caps: label 200, name 100 (store, input, prompt) | `consistency.test.ts` |
| Giant or malformed model output | Huge or broken UI and export | Length caps; parse failures → fallback | 13 failure modes × 2 paths |
| Fake or duplicate Flags via `applyTransitions` | Forged observations | **Accepted:** client-side tool whose only user is the Interviewer. Nothing is shared or persisted, so the only forger is the reader | Documented |

## Security Findings

| Finding | Severity | Mitigation | Status |
|---|---|---|---|
| Third-party telemetry from MediaPipe | Medium (privacy claim) | Host blocked; CSP `connect-src 'self'` | Fixed |
| XSS via name, label or LLM text | None found | React text rendering only; no `innerHTML` / `dangerouslySetInnerHTML` | Verified |
| Markdown export keeps raw HTML-like text | Low | Only matters if someone renders the file as HTML elsewhere | Accepted |
| Dev or preview server exposed on the LAN | None | Vite binds localhost only (no `server.host`) | Verified |
| Ollama exposed | None | Bound to 127.0.0.1:11434; reached only via the localhost proxy | Verified |
| Arbitrary file access | None | Local Video reads only the user-picked file via a revoked blob URL | Verified |
| Export filename injection | None | Slug `[a-z0-9-]` | Verified |
| Auth / SQL / command / path traversal | N/A | No backend, database or shell | — |

## Database / Storage Findings

- **Architecture:** there is **no database.** One in-memory store (`src/store/session.ts`) lives in the browser tab's JS heap.
- **Schema:** the TypeScript types in `src/domain/types.ts` (ARCHITECTURE §4).
  - Session holds consent, source, baseline, questions[], flags[], moments[], followUp, timeline[] and report.
  - Relationships are by id: `Flag.questionId`, `Moment.questionId`, `Moment.flagIds`, `TimelineEvent.questionId`.
  - There are no database constraints. Integrity is enforced in code and checked by `checkConsistency()` (`src/store/consistency.test.ts`):
    - all references resolve;
    - each Flag sits on the Question active at its start;
    - at most 2 follow-ups per Question;
    - timeline counts match;
    - report journeys and Markdown match the Session;
    - JSON round-trips.
- **Persistence:** none. No localStorage, sessionStorage, IndexedDB or cookies (verified in the browser and by grep).
- **Lifecycle:** Consent draft → Session → New session or reload wipes everything. Reload mid-session loses the Session with no warning (accepted; no `beforeunload` added).
- **Data flow:**

| Data | Stays local? | Leaves the device? | Stored? |
|---|---|---|---|
| Video, audio, landmarks | Yes, processed in memory per frame | Never | Never |
| Signals, Flags, Moments, timeline | Yes | Text only, to Ollama on 127.0.0.1 (same machine) | In memory until New session or reload |
| Candidate name | Yes | Not sent to the LLM (test-enforced) | In memory; in exports |
| Exports (.md, .json, PDF) | Written only where the Interviewer saves them | Only if the Interviewer shares the file | On disk, by explicit user action |

## Question & Follow-up Findings

- **Question Bank:** there is **none.** Questions are created live by the Interviewer:
  - with the N key or the "+ New Question" button;
  - with an optional label, capped at 200 characters;
  - Q1 "Introduction" is created at Session start.

  A preset question bank is P2 in the PRD (§25).
- **Active Question:** the last one in `session.questions`. Flags belong to the Question active when they **start** (FR-007). A Flag that continues into the next Question keeps its owner, and is now also counted by the gate in the new Question after its grace window (B5).
- **Follow-ups:**
  - Generated only when the gate or Explore opens a Moment.
  - The reducer enforces `MAX_FOLLOW_UPS = 2`.
  - 0, 1 and 2 follow-ups and an attempted 3rd were all verified; the 3rd is ignored.
  - Continue, Dismiss and Explore follow the transition table.
  - Double Ask spends one follow-up.
  - New Question resets the loop.
- **Stop condition:** settled (30 s with no trigger) or limit reached (a trigger after 2 follow-ups). Dismissed stops suggestions for the Question.
- **Open UX gap:** a new Question during re-observation leaves the earlier Moment with no result. The report now says "Re-observation did not finish before the Question ended."

## Audio / Speech Findings

| Question | Answer |
|---|---|
| Interviewer audio | Picked up by the webcam mic in the same room. **Not separated from the Candidate** |
| Candidate audio | Webcam mic (in-person). Meeting window: usually **none** (Chrome shares audio for tabs or the entire screen, rarely for a single window). Local Video: from the file |
| VAD | **Yes, energy-based** (RMS every 50 ms, adaptive noise floor, 150 ms onset / 400 ms release). Verified with a synthetic tone |
| Whisper / whisper.cpp / ASR | **Not implemented** (grep-verified). No transcription anywhere |
| Local / cloud | Fully local. Audio is never recorded, played, uploaded or sent to the LLM |
| Used by the gate? | **Yes.** Off-screen glances inside a pause of 4 s or less that ends with speech resuming are ignored (dead air / thinking). With no audio, stricter rules apply: 8 s sustained instead of 6 s, 4 glances instead of 3 |
| Current status | Works for "speaking → short pause → looks away → continues". Weaknesses: an in-room Interviewer's voice counts as speech; window mode has no audio; noisy rooms |
| Recommendation | **Keep energy VAD for the MVP.** Transcription adds nothing the gate uses and whisper.cpp would compete with the LLM for 8 GB RAM. Silero VAD (about 2 MB ONNX) would reject noise better but still can't separate speakers. Post-hackathon only |

## Model & Hardware Findings

| Item | Value (measured on the i5-13420H / RTX 3050 4 GB / 7.7 GB laptop) |
|---|---|
| Vision model | MediaPipe Face Landmarker (`face_landmarker.task`, vendored), `@mediapipe/tasks-vision` 1.1.0 |
| Vision runtime | WASM, GPU delegate (WebGL) with automatic CPU fallback. **Not** ONNX Runtime or WebGPU (deviation from PRD §14A.1, disclosed) |
| Vision speed (fake camera, no face, headless on the Intel iGPU) | GPU: 20 fps (camera-limited), p50 9.3 ms/frame. CPU: 19.3 fps, p50 11.9 ms/frame. RTX-GPU and real-face numbers PENDING MANUAL RUN |
| Vision cap | 30 fps (lightweight 15). PRD target 5–10 fps; the reading rule was verified at 10, 15 and 30 fps in synthetic tests |
| LLM | qwen2.5:3b, Q4_K_M GGUF, 3.1B parameters, 1.93 GB on disk, 2.16 GB VRAM, Ollama 0.40.1, context 4096 |
| LLM invocation | Event-driven only: Moment opened, persisting, Session end; plus a warm-up on load. Never on a timer |
| LLM input | Question label (clipped), Flag descriptions, follow-up count, gate reason. **No video, audio, landmarks, images or Candidate name** |
| LLM latency | Cold load 11.4 s. Per Moment p50 5.9 s, p95 12.6 s (shared GPU). Flag → Moment opened 134–273 ms |
| Memory | Browser 334–385 MB during a live Session; JS heap 23–28 MB, flat over 5 minutes |
| Fallback mode | Step-down qwen3:4b → qwen3:1.7b → qwen2.5:3b is unit-tested; **not exercised on hardware** because only qwen2.5:3b is installed |
| 8B+ / multimodal / concurrent LLMs | None |

## Offline Test Results

| Component | Result |
|---|---|
| Internet actually blocked (dead proxy, loopback allowed) | PASS |
| App load (production build) | PASS |
| Vision model load (vendored, no CDN) | PASS |
| Third-party requests during a Session | PASS (0, after B1) |
| Local LLM suggestions | PASS (3/3 from the model) |
| Session Report | PASS |
| Full live Session from the production UI with the fake webcam | NOT TESTED (fake device failed under the proxy run) |
| **Real Wi-Fi-off run on the demo laptop** | **NOT TESTED — PENDING MANUAL RUN** |
| What stops without internet | Only the online meeting transport (Meet/Zoom/Teams). We never claim it keeps working |

## Remaining Risks

1. **Real-face accuracy is unverified.** If MediaPipe gaze on this webcam is noisy, the Baseline, off-screen and reading rules may misfire. This is the single biggest risk.
2. **LLM latency of 5–12 s.** A suggestion can take a while, and when it runs out of time it falls back to template text. Keep Ollama warm and close other GPU apps during the demo.
3. **Qwen3 models from PRD §14A.1 are not installed or benchmarked.** Standard and lightweight modes are verified in code only.
4. **Window mode has no audio**, so it uses the stricter visual-only rules. It is also untested with a real meeting window.
5. An in-room Interviewer's voice counts as speech and can mask a real off-screen glance as "thinking".
6. **A Baseline relearned during a look-away absorbs it.** Recommend resetting only while the Candidate faces the screen.
7. A Baseline reset during re-observation can let it settle with no gaze evidence.
8. Labels about honesty or nervousness always get the template follow-up (deliberate false reject).
9. The report's timestamps and durations from the LLM are not fact-checked, only the Flag kinds it names.
10. No platform-consent connector (FR-001 option 1). Interviewer confirmation is the only path.
11. Reload mid-session loses the Session with no warning.

## Pre-Submission Checklist

- [ ] Consent verified *(code + browser PASS; re-check in the real run)*
- [ ] Source selection verified *(webcam + Local Video PASS; meeting window PENDING)*
- [ ] Baseline verified *(real face PENDING)*
- [ ] Thinking pause ignored *(synthetic PASS; real voice + face PENDING)*
- [ ] Distraction ignored *(synthetic PASS; real PENDING)*
- [ ] Reading pattern verified *(synthetic PASS; real PENDING)*
- [ ] Face missing verified *(synthetic PASS; real PENDING)*
- [ ] Second face verified *(synthetic PASS; real PENDING)*
- [x] Question tracking verified
- [x] Follow-up limit verified
- [x] Stop condition verified
- [x] Interviewer override verified
- [x] Local LLM verified *(qwen2.5:3b, 22 live runs)*
- [x] Banned-word guard verified
- [x] Audio/speech status documented
- [x] Database/storage documented
- [x] Security audit completed
- [ ] Offline test completed *(simulated PASS; real Wi-Fi-off PENDING)*
- [ ] Hardware benchmark completed *(LLM + headless vision done; real-face/RTX rows PENDING)*
- [x] Report verified
- [ ] PDF export verified *(print stubbed headless; do one real Save as PDF)*
- [ ] Demo rehearsed
- [ ] GitHub link ready *(repo pushed; set the URL in `landing/index.html`)*
- [ ] Demo video ready
- [ ] X/LinkedIn post ready
- [x] Hardware disclosure ready *(README + BENCHMARK, actual laptop)*
- [x] Model disclosure ready
- [x] Local-vs-cloud disclosure ready

## Top 5 before submission

1. **Real-face rehearsal on the demo laptop** (§14 steps 1–12) in headed Chrome. Check that the status bar shows the GPU, the Baseline completes, a thinking glance is ignored, reading → Moment → Ask → settled, and the limit path works. Fill in the PENDING rows in BENCHMARK.md.
2. **Real Wi-Fi-off run** with Local Webcam (§14 step 13): vision, Flags, LLM follow-up and report all work. Then stop Ollama and confirm the template fallback (§14 step 14).
3. **One real PDF:** Export PDF → Save as PDF with Wi-Fi off. Open it and check there are no images and the layout is clean.
4. **Demo-day setup:**
   - close other GPU apps;
   - open the app 1–2 minutes early so the model is warm;
   - use the webcam for the core demo, and treat meeting-window mode as "shown, not relied on" unless tested with a real call.
5. **Submission links:**
   - record the demo video;
   - set the GitHub, demo and post URLs in `landing/index.html`;
   - deploy `landing/` and make `og:image` absolute;
   - publish the X/LinkedIn post.


---

# v1.3 Architecture Change: transcript-grounded follow-ups (2026-10-10)

## Why
The audit asked: *how does the system know what follow-up to ask?* Before v1.3 it didn't. There was no transcript. The model received only the Question label and the gaze/face Flags, so the Flag effectively chose the follow-up. A complete answer still got a generic one ("Could you walk me through what you personally did…"). Cases A–G could not be distinguished.

## Assessment
| | |
|---|---|
| **CURRENT (before)** | Vision → Baseline/rules → evidence gate → follow-up reducer (max 2, 30 s re-observe). Energy VAD only. Qwen2.5:3b wrote a note plus a generic follow-up from the Flags. Manual "New Question" with a typed label. |
| **PROBLEM** | No conversational context, so a follow-up could not be grounded in the answer, could not be skipped when the answer was complete, and could not avoid re-asking. |
| **KEEP** | Vision pipeline, gate and thresholds, follow-up reducer and MAX_FOLLOW_UPS, guard/banned language, Ollama client, Consent, CSP, telemetry block, exports. |
| **REPLACE** | Generic Flag-driven follow-up → transcript-grounded reasoning. Manual Question as the primary path → spoken-question detection (manual stays as fallback). |
| **ADD** | whisper.cpp server, per-source audio capture, utterance pipeline, transcript store, context window, gap analyzer, Live context panel, "Why this follow-up". |

## New pipeline
```text
Interviewer mic ─┐                       ┌─ Candidate video → MediaPipe → Signals → Baseline/rules/gate
Interview audio ─┴→ utterances (VAD, ≤15 s) → whisper.cpp (127.0.0.1:8178) → Transcript ─┐        │
                                              question detection ← interviewer lines    │        │
                                      CONTEXT ENGINE (question + answer + previous follow-ups + gaps)
                                              │  worth exploring (gate)  AND  real gap not yet asked?
                                       no → "No follow-up suggested — <reason>"     yes → Qwen words ONE follow-up
                                                                                         → guard → Interviewer Ask/Continue/Dismiss
```
Rule: **vision decides *whether*, conversation decides *what*.** The observation is passed to the model as context only. The guard rejects any follow-up about eyes, screen, notes or reading.

## Modules
| Area | Files | What it does |
|---|---|---|
| Local ASR | `scripts/whisper-setup.ps1`, `scripts/whisper-server.mjs`, `src/asr/*`, `/whisper` proxy | whisper.cpp b5454 CPU build, `tiny.en`, 4 threads, bound to 127.0.0.1:8178. Client sends a 16 kHz WAV in memory and strips non-speech tokens. `/health` probe. |
| Mic capture | `src/capture/source.ts` | `openMic(deviceId)` with echo cancellation and noise suppression. Device dropdown on the Source screen. |
| System/application audio | `src/capture/source.ts` | `getDisplayMedia({audio:true})` with no preferred surface. Chrome/Windows gives audio for a **tab** or the **entire screen**, never a single window. In that case `shareAudioNotice()` shows the exact fix. No faking. |
| Utterances | `src/audio/utterances.ts` | Streaming 16 kHz downsampler, VAD segmenter (reuses SpeechActivityDetector thresholds, 300 ms pre/post-roll, 15 s cut, <0.5 s dropped), one request at a time per stream, drop-oldest queue (>3). PCM lives in memory only until it is transcribed. |
| Speaker separation | controller | By source: mic = `interviewer`, tab/system/file audio = `candidate`, webcam shared mic = `mixed`. No voice diarization. |
| Question detection | `src/context/questions.ts` | Interviewer/mixed line that looks like a question (prompt words or "?", ≥5 words, filler blocklist) at least 20 s into the current Question → new Question (`origin: "spoken"`). Within 20 s of Ask or while re-observing it counts as the follow-up being spoken, not a new Question. The first question relabels the auto Q1 if the Candidate hasn't spoken yet. "Mark new question" (N) is the fallback. |
| Context window | `src/context/answer.ts` | Question text, the Candidate's answer (last 1200 chars), last 6 lines, previous follow-ups and their gaps. Never the whole interview. |
| Gap analyzer | `src/context/gaps.ts` | Deterministic and explainable: **personal contribution** ("we/team", no concrete "I did"), **specific steps** (vague "solved/fixed/finished", no how), **outcome** (no result). <8 words = too brief to judge (no follow-up). Each gap has an evidence sentence. |
| Reasoning wrapper | `src/llm/contract.ts`, `guard.ts`, `moments.ts` | No transcript / too brief / complete / every gap already asked → **no follow-up, model not called**. Otherwise Qwen gets the §28 v1.3 input and must pick an un-asked analyzer gap. The guard checks: neutral, one "?", caps, grounded, Jaccard <0.6 vs previous follow-ups, no eyes/screen/notes/reading. One retry, then a template for the first un-asked gap, filled with a topic noun from the answer. Waits up to 8 s for the Candidate's utterance to end, then re-reads the latest transcript. |
| UI | `LiveScreen`, `SourceScreen`, `StatusBar`, `FollowUpCard` | Live context panel (last 4 lines, ● Listening / ● Observing). Source chips (Mic / Interview audio / Video / Speech recognition). "Why this follow-up: Q · Answer covered · Unclear: gap — reason". "No follow-up suggested — reason" with Continue only. |
| Report/exports | `src/llm/report.ts`, `ReportScreen` | Per Question: spoken text, follow-ups with "Why". Timeline includes Interviewer/Candidate speech events (**without words** in Markdown/PDF). The transcript is only in the JSON export. |

## Follow-up reasoning: Cases (tests + live)
| Case | Expected | Unit test (mocked LLM) | Live qwen2.5:3b (3 runs) |
|---|---|---|---|
| A complete answer | no follow-up | ✓ | 3/3 (model not called) |
| B team, not self | personal contribution | ✓ | 3/3 "What specific tasks did you handle in the project?" |
| C "I solved it", no how | specific steps | ✓ | 3/3 "What specific steps did you take to solve the login flow bug?" |
| D no result | outcome | ✓ | 3/3 "What was the outcome of fixing the payment service issues?" |
| E Flag + complete answer | no follow-up | ✓ (even if the model returns one) | 3/3 |
| F Flag + gap | targeted follow-up reusing the answer's topic | ✓ | 3/3 |
| G personal already asked | different gap, no repeat | ✓ | 3/3 → specific steps |
| G2 no gap left | none | ✓ | 3/3 |
| No transcript | none, `basis: no-transcript` | ✓ | — |
| Model asks "Were you reading?" | rejected → template | ✓ | — |
| Hero demo | personal contribution on "backend" | ✓ | 3/3 "What specific tasks did you perform on the backend?" |

**Known model weakness:** in a raw probe without the wrapper, qwen2.5:3b *never* says an answer is complete; it invents a "specific steps" gap for A/E/G2. The deterministic analyzer decides those cases first, so the app still suggests nothing. The reason shown is always the analyzer's evidence sentence, never model free text.

## Real browser end-to-end (2026-10-10, headed Chrome, fake devices)
Setup:
- **Mic:** SAPI speech WAV, played into the browser as the fake microphone. It carries the question, then the hero answer.
- **Camera:** a gray Y4M as the camera, so there is no face → a Face-missing Flag.
- **Services:** dev server, whisper `tiny.en`, Ollama `qwen2.5:3b`.

Observed:
- Transcript lines arrived ("Tell me about a difficult project you have worked on.", "I worked on a web application with my team.", "The back end was difficult.", "But eventually we finished it.").
- The spoken question became **Q2 (`origin: spoken`)** automatically.
- The gate opened a Moment.
- Qwen produced **"What specific tasks did you perform on the back end?"** with reasoning "personal contribution — The answer describes the team's work ("team" ×1, "we" ×1) but not what the Candidate personally did."
- A Moment opened during the earlier 5-word fragment showed "too brief to judge — no follow-up suggested".
- **0 requests left localhost** during the run (all traffic same-origin `/ollama`, `/whisper`).

Screenshot checked: card, Why line, Live context, chips.

## Audit status (honest)
**WORKING (verified):**
- local whisper transcription (clean speech, word-for-word);
- utterance segmentation → transcript in a live Session;
- spoken-question detection;
- transcript-grounded follow-up with reasoning;
- no-follow-up paths (complete / too brief / no transcript / gaps exhausted);
- guard against observation-based questions;
- max-2 enforced in the reducer;
- no traffic beyond localhost;
- all unit tests: 436 passed, 1 skipped (opt-in live);
- typecheck clean.

**FIXED in v1.3:**
- Flag-driven generic follow-ups;
- a complete answer still getting a follow-up;
- repeated probing of the same point;
- the manual Question label as the primary path;
- the stale-transcript race (the session was read before the queue wait; now re-read via `latest`);
- transcript text leaking into Markdown/PDF.

**PARTIALLY WORKING:**
- **Speaker separation:** by source only; a shared mic is "mixed". Without headphones the Interviewer mic can hear the Candidate (echo cancellation helps, not guaranteed).
- **Gap analyzer:** suits behavioural/experience questions (three areas). For other question types its checks may not fit.
- **Interviewer Note duration:** on a Flag that began in an earlier Question it reports the whole duration (e.g. "66 s during Q2").
- **ScriptProcessor:** deprecated but works.

**NOT TESTED (needs a person at the laptop):**
- the real Chrome share picker with "Share tab audio" / "Share system audio";
- a real two-person meeting;
- transcription accuracy on real voices, accents and noise;
- echo without headphones;
- whisper latency while the LLM is generating at the same moment;
- a real Wi-Fi-off run with whisper;
- a real face (the fake camera has none);
- Save-as-PDF with the new report.

**KNOWN LIMITATIONS:**
- A single-window share has no audio in Chrome, so for meetings use tab or entire-screen share.
- whisper.cpp needs a one-time download (`npm run whisper:setup`) and runs as a second local process.
- tiny.en is English only.

**SECURITY:**
- whisper-server binds 127.0.0.1 only (netstat verified).
- The browser reaches it only via the same-origin proxy (the CSP is unchanged).
- Audio is never stored.
- The transcript is in memory, and only in the JSON export.
- Downloads come from official GitHub/HF releases into a gitignored `tools/`.
- Residual: any local process can call whisper-server/Ollama on loopback (same as before).

**PERFORMANCE:**
- whisper tiny.en: 0.5–0.65 s per 12.7 s utterance, 126–169 MB RAM.
- Qwen follow-up call: ~5 s median in the live bench (1.6–2.3 s in an earlier run).
- Total follow-up latency ≈ utterance end + whisper (~0.6 s) + Qwen (2–5 s).
- Measured at the moment the follow-up appeared (2nd E2E run, which reproduced the same follow-up):
  - all Chrome processes 998 MB (includes the user's other Chrome windows);
  - whisper-server 130 MB;
  - Ollama runner 35 MB of RAM (the model sits in VRAM: 2169 MiB GPU);
  - system RAM in use 7362 / 7862 MB with dev tools and agents also running.
- **8 GB is tight:** close other apps for the demo. A clean-machine total is PENDING MANUAL RUN.

**SUBMISSION BLOCKERS:**
- none in code;
- the manual items above (especially a real meeting tab with audio and a real face) plus the demo video and landing links.

## Hero demo script (deterministic)
1. Start `npm run whisper`, Ollama and `npm run dev`. Use headphones.
2. **Local Webcam** (in person) or **Online Interview → share the meeting tab with tab audio**.
3. After the Baseline, ask: "Tell me about a difficult project you've worked on."
4. The Candidate says: "I worked on a web application with my team. The backend was difficult, but eventually we finished it." They read from notes or look away for a sustained period.
5. **Moment worth exploring** → "What specific tasks did you perform on the backend?" (wording varies). The Why line shows personal contribution.
6. Click **Ask Follow-up**, say it, and the Candidate answers looking at the camera → re-observe 30 s → **Observation settled. No further follow-up suggested.**
7. Show the same with a complete answer: a Flag may be recorded, but "No follow-up suggested".
