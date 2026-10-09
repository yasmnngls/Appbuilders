# Local AI Interview Assistant — Product Requirements Document

**Version:** 1.2  
**Status:** Hackathon MVP / Build Specification  
**Event:** AppBuildersPH Hackathon 2026  
**Theme:** Local AI  
**Primary User:** Interviewer  
**Primary Subject:** Candidate

---

## 1. Product Overview

### 1.1 Product Name

**Local AI Interview Assistant**

### 1.2 Tagline

> **Notice. Follow up. Know when to move on.**

### 1.3 One-Line Pitch

A private, on-device interview assistant that helps Interviewers notice moments worth exploring, suggests neutral follow-up questions, re-observes what happens, and helps them know when to move on.

### 1.4 Product Positioning

The product is **not a standalone AI interviewer and not an AI eye-tracking or candidate-monitoring system**. It is a Local AI interview-assistance layer that can work alongside an existing interview or assessment platform.

Gaze and face signals are inputs to a broader interview-assistance workflow:

> **Observe → Understand → Follow Up → Re-observe → Resolve → Move On**

The system does not determine whether a Candidate is honest, cheating, uncomfortable, suitable for hiring, or suspicious. It reports observable patterns and gives the Interviewer neutral options for exploration.

---

# 2. Hackathon Context

AppBuildersPH Hackathon 2026 is a 24-hour hackathon centered on **Local AI**. The event defines Local AI as useful AI experiences where meaningful AI computation happens locally on the user's device rather than depending entirely on cloud inference.

The hackathon allows local LLMs, local vision models, local speech, local embeddings/RAG, local agents, edge AI, offline AI, privacy-preserving AI, and hybrid local/cloud systems. Cloud services may be used, but meaningful AI functionality must run locally.

The challenge emphasizes building an AI product that remains genuinely useful when the cloud disappears.

The product therefore treats local inference as a core product capability rather than a technical add-on.

---

# 3. Problem Statement

During an interview, an Interviewer has to simultaneously:

- listen to the Candidate,
- understand the answer,
- remember the Question,
- decide what to ask next,
- notice potentially relevant behavioral patterns,
- keep the conversation moving,
- and document important moments.

A potentially useful moment can therefore be missed.

Existing approaches can also over-focus on monitoring or scoring the Candidate. This creates a different problem: the system may produce a judgment when what the Interviewer actually needs is a neutral signal that something may be worth exploring.

### Problem

> **Interviewers need help noticing and exploring potentially meaningful moments without delegating judgment about the Candidate to an AI system.**

---

# 4. Product Opportunity

Instead of building another system that asks:

> "Is this Candidate suspicious?"

the product asks:

> **"Is there a moment worth exploring?"**

The assistant is designed as a **Local AI companion/layer for an existing interview or assessment platform**. The existing platform may handle candidate interaction, questions, recording, transcription, or interview transport. This product does not need to replace those capabilities. Its role is to provide the local observation and interviewer-support layer that helps a human interviewer decide what is worth exploring.

The assistant then supports a bounded workflow:

1. Observe the Candidate locally.
2. Compare signals against the Candidate's own baseline.
3. Detect a meaningful temporal pattern.
4. Surface a neutral Flag.
5. Generate a grounded follow-up suggestion.
6. Let the Interviewer decide whether to ask it.
7. Re-observe after the follow-up.
8. Determine whether the observed pattern has settled.
9. Stop and let the Interviewer continue.

The core differentiator is **bounded interview exploration**, especially the ability to recognize when a moment is merely normal interview behavior, when a pattern is worth exploring, and when no further follow-up is needed.

---

# 5. Goals

## 5.1 Primary Goals

1. Provide a useful interview assistant that runs meaningful AI inference locally.
2. Help Interviewers notice moments worth exploring.
3. Generate neutral, context-grounded follow-up questions locally.
4. Learn a Candidate's normal gaze behavior through an automatic baseline.
5. Detect temporal patterns rather than reacting to individual frames.
6. Distinguish brief, plausible thinking/distraction behavior from persistent or repeated patterns before surfacing a moment.
7. Combine multiple available signals and interview context rather than treating gaze deviation alone as sufficient evidence.
8. Keep the Interviewer in control of every follow-up decision.
9. Re-observe after follow-up and provide a clear stop condition.
10. Keep sensitive Candidate video processing local for the core AI workflow.
11. Demonstrate meaningful local-AI functionality without internet connectivity, without claiming that an internet-based interview transport continues offline.
12. Produce a concise Session Report without storing Candidate images.

## 5.2 Secondary Goals

- Make observations explainable.
- Make the interface feel like an Interviewer assistant rather than surveillance software.
- Make the product understandable within a short live demo.
- Demonstrate a technically sophisticated but bounded local-AI workflow.

---

# 6. Non-Goals

The MVP will **not**:

- assign a Candidate score,
- calculate a cheating probability,
- calculate an honesty score,
- determine whether a Candidate is lying,
- determine whether a Candidate is uncomfortable,
- infer personality,
- perform facial attractiveness analysis,
- make a hiring recommendation,
- perform face recognition,
- identify Candidates,
- continuously upload Candidate video to cloud AI,
- create a large analytics dashboard,
- store Candidate images as part of the Session Report,
- autonomously interrogate the Candidate,
- generate unlimited follow-up questions.

The product reports observations. The Interviewer interprets them.

---

# 7. Terminology

The following terminology is canonical for the product.

| Term | Definition |
|---|---|
| **Interviewer** | Person running the interview and the only user of the application. |
| **Candidate** | Person being interviewed whose face is observed by the application. |
| **Session** | One interview from Consent to End. |
| **Consent** | Interviewer confirmation that the Candidate was told about on-device gaze analysis and agreed. |
| **Source** | Where the Candidate's face comes from: an existing online interview/assessment window, local webcam, or local video for offline analysis. |
| **Question** | A stretch of a Session beginning when the Interviewer marks a new interview question. |
| **Signal** | Raw measurement from one video frame, such as face count, head direction, or gaze direction. |
| **Baseline** | Candidate's normal gaze centre and natural wander learned during the first seconds. |
| **Flag** | Timestamped observation raised by a rule over Signals. |
| **Interviewer Note** | Short plain-language summary generated locally from recent Flags, potentially with a suggested follow-up. |
| **Session Report** | End-of-session summary organized by Question and exportable by the Interviewer. |

### Flag Types

1. **Looking off-screen** — gaze held well outside the Candidate's Baseline.
2. **Reading pattern** — repeated left-to-right sweeps with quick returns, resembling reading lines of text.
3. **Face missing** — no face visible.
4. **Second face** — more than one face visible.

A Flag is an observation, **never a verdict**.

---


## 7.1 Temporal and Contextual Interpretation

The assistant must not treat every gaze deviation as a meaningful event. Looking away can occur naturally while a Candidate is thinking, planning an answer, hesitating, or continuing a speaking turn. Therefore, the product interprets Signals over time and in relation to the current Question rather than reacting to a single frame or brief gaze shift.

The decision hierarchy is:

```text
Signal
  ↓
Baseline comparison
  ↓
Temporal pattern
  ↓
Context / available speech state
  ↓
Evidence gate
  ├── ordinary / brief → ignore
  ├── persistent / repeated → Flag
  └── insufficient evidence → continue observing
```

### Normal interview behavior

Examples that should normally **not** trigger a follow-up:

- brief gaze aversion while thinking,
- a single short glance away,
- a short pause or dead-air moment,
- gaze returning quickly to the Candidate's normal range,
- one isolated head movement,
- a brief face-detection interruption.

### Moment worth exploring

A follow-up candidate should require a meaningful temporal pattern, such as persistence, repetition, or a recognizable sequence of Signals. The assistant should prefer **"observe more"** over **"surface now"** when evidence is weak.

The product must never claim that a gaze pattern reveals the Candidate's mental state or reason for looking away. It can only report the observable pattern and let the Interviewer decide whether it is worth exploring.

### Decision examples

| Observation | System behavior | Follow-up? |
|---|---|---|
| 1-second gaze deviation | Continue observing | No |
| Short pause + gaze aversion + answer resumes | Treat as ordinary/temporary | No |
| Single brief distraction | Continue observing | No |
| Repeated gaze deviation over a sustained interval | Raise Flag if thresholds are met | Maybe |
| Repeated reading-like sweeps | Raise Reading Pattern Flag if thresholds are met | Potentially |
| Face missing briefly | Continue observing | No |
| Face missing persistently | Raise Face Missing Flag | Potentially |
| Second face briefly appears | Continue observing / require persistence | No |
| Second face persists | Raise Second Face Flag | Potentially |

These are product-behavior examples, not claims about the Candidate's intent or mental state.

# 8. Target User

## Primary User: Interviewer

The Interviewer is the only application user.

The Interviewer needs to:

- run an interview,
- see the Candidate,
- mark Questions,
- notice important moments,
- receive neutral assistance,
- decide whether to ask a follow-up,
- and review the Session afterward.

## Candidate

The Candidate does not install or operate the application.

The Candidate is observed only after Consent has been confirmed. Consent may be established by the existing interview/assessment platform, or explicitly confirmed by the Interviewer when the external platform does not expose a consent state to the assistant.

## Product Positioning: Local AI Layer

The product is **not a replacement for an existing AI interview or assessment platform**. It is a Local AI layer that can work alongside one.

The existing platform may conduct the interview, present questions, manage candidate interaction, or provide the online meeting/assessment environment. This product adds the local observation and human-in-the-loop follow-up layer:

```text
Existing Interview / Assessment Platform
        │
        │ Candidate video / question context
        ▼
┌─────────────────────────────────────┐
│       LOCAL AI INTERVIEW LAYER      │
│                                     │
│ Local Vision → Baseline → Flags     │
│                     ↓               │
│              Local LLM              │
│                     ↓               │
│        Follow-up / Re-observe        │
└─────────────────────────────────────┘
        │
        ▼
     Interviewer
```

### Product Boundary

**Existing platform:** conducts or hosts the interview.

**Local AI Assistant:** observes locally, identifies patterns worth exploring, suggests neutral follow-ups, re-observes, and helps the Interviewer know when to move on.

This positioning also makes the Local AI value explicit: the interview may still require internet connectivity, but the AI analyzing the Candidate does not need to send Candidate video to a cloud AI inference service.


---

# 9. Core Product Principle

## Observe, Don't Judge.

The product must consistently distinguish between:

### Observation

> "A repeated reading-like gaze pattern was observed."

and:

### Interpretation

> "The Candidate was cheating."

The first is allowed.

The second is outside the product's role.

The UI, prompts, generated notes, reports, and demo language must preserve this distinction.

---

# 10. Core User Journey

```text
Existing Platform / Interview Setup
   ↓
Consent Confirmed
   ↓
Interview Source
   ↓
Baseline Learning
   ↓
Live Interview
   ├── Video → Local Vision → Signals → Flags
   ├── Questions → Question Context
   └── Flags + Question → Local LLM → Interviewer Note
   ↓
Moment Worth Exploring?
   ↓
Interviewer chooses:
   ├── Continue
   └── Ask Follow-up
             ↓
        Re-observe
             ↓
        Pattern Settled?
        ├── YES → Move On
        └── NO → Final Follow-up
                         ↓
                       STOP
   ↓
End Session
   ↓
Session Report
   ↓
Export
```

---

# 11. Adaptive Follow-Up Loop

This is the product's hero feature.

## 11.1 Trigger

A follow-up suggestion can be created only when the observation passes a **bounded evidence gate**:

1. A Flag or meaningful pattern is raised.
2. The event occurs during an active Question.
3. The pattern persists, repeats, or forms a recognizable temporal sequence.
4. The event is not adequately explained by a brief/isolated observation that should normally be ignored.
5. Available context does not indicate that the Candidate is simply in a normal thinking, hesitation, or speaking-planning moment.
6. The pattern has enough grounded context for a neutral follow-up to be useful.

The system should **not** generate a follow-up for every Flag. A single gaze deviation, short dead-air period, or brief distraction should normally result in continued observation rather than intervention.

### Example: dead air / thinking

```text
Question: "Tell me about a difficult project."

Candidate pauses → looks slightly away → resumes answer

Observation: short gaze deviation
Pattern: single occurrence
Action: IGNORE / CONTINUE OBSERVING
```

### Example: repeated pattern

```text
Candidate answers → gaze moves outside baseline
        ↓
returns → moves outside baseline again
        ↓
repeated reading-like sweeps
        ↓
persistent pattern

Action: MOMENT WORTH EXPLORING
```

The product should optimize for **precision over frequency**: it is better to miss a weak moment than to interrupt the Interviewer with a suggestion every time the Candidate looks away.

## 11.2 Follow-Up Limit

**Maximum: 2 follow-ups per Question.**

This is a product guardrail to prevent the assistant from repeatedly interrupting or interrogating the Candidate.

## 11.3 Interviewer Decision

The Interviewer always chooses:

- **Ask Follow-up**
- **Continue**
- optionally **Dismiss**

The assistant never asks the Candidate autonomously.

## 11.4 Re-observation

After the Interviewer asks a follow-up, the system resumes observation.

It evaluates whether the relevant pattern:

- settled,
- weakened sufficiently,
- continued,
- or produced another notable pattern.

## 11.5 Stop Condition

The system stops suggesting follow-ups when:

- the observation settles, or
- the maximum number of follow-ups is reached.

Example:

> **Observation settled. No further follow-up suggested.**

The Interviewer can then move to the next Question.

---

# 12. Functional Requirements

Priority:

- **P0** = required for MVP/demo
- **P1** = important if time permits
- **P2** = post-hackathon

---

## FR-001 — Consent Gate

**Priority:** P0

The assistant must not begin Candidate observation until Consent has been confirmed.

### Consent Sources

1. **Existing platform consent** — preferred when the existing interview/assessment platform already presents the Candidate-facing disclosure and can provide a confirmed consent state.
2. **Interviewer confirmation** — fallback for local or integrated setups where the external platform does not expose consent state. The Interviewer confirms that the Candidate was informed about on-device gaze analysis and agreed.

### Requirements

- Consent must be explicit and recorded for the current Session.
- Session observation cannot begin without Consent.
- The assistant must never silently infer consent from camera availability.
- The UI must clearly communicate that the core analysis runs on-device.
- The Candidate does not need to install or operate the assistant.

---

## FR-002 — Video Source Selection

**Priority:** P0

The Interviewer must choose a Candidate video Source.

### Supported Sources

1. **Online Interview / Assessment Window** — captures the Candidate from an active meeting or assessment window. The online interview itself still requires internet connectivity.
2. **Local Webcam** — for in-person or locally hosted interviews.
3. **Local Video** — P1 source for analyzing a locally stored interview video without internet connectivity; especially useful for the hackathon Offline Test.

The Source should be displayed before the Session begins.

---

## FR-003 — Local Vision Analysis

**Priority:** P0

The system must perform meaningful vision inference locally.

The local vision pipeline should produce Signals including:

- face count,
- head direction,
- gaze direction.

The system must not require cloud AI for core vision inference.

---

## FR-004 — Automatic Baseline

**Priority:** P0

At the beginning of a Session, the system must learn the Candidate's normal gaze behavior.

### Baseline includes

- approximate gaze centre,
- natural gaze wander,
- normal range of movement.

The system should avoid treating generic eye movement as suspicious.

### UX

```text
Learning Candidate Baseline

● Natural gaze range
● Typical head direction
● Normal movement

[ progress ]

Baseline ready ✓
```

---

## FR-005 — Temporal and Contextual Signal Processing

**Priority:** P0

The system must process Signals over time rather than making decisions from a single frame.

### Principle

```text
Frame
 ↓
Signal
 ↓
Baseline Comparison
 ↓
Temporal Pattern
 ↓
Context Gate
 ↓
Rule
 ↓
Flag or Ignore
```

### Required behavior

- Short, isolated movements should generally not create Flags.
- A brief gaze deviation during a pause or while thinking should normally be ignored.
- The system should look for persistence, repetition, or recognizable sequences.
- Where available, lightweight speech activity / turn state may be used as context; it should not be treated as proof of intent or mental state.
- A short pause combined with brief gaze aversion should normally remain an observe/continue state.
- If speech context is unavailable, use stricter visual-only thresholds rather than making stronger inferences.
- If evidence is insufficient, the system continues observing instead of surfacing a follow-up.

### Internal event categories

1. **Ordinary** — expected/brief behavior; no action.
2. **Transient** — notable but too short or isolated; continue observing.
3. **Patterned** — persistent or repeated behavior meeting Flag thresholds.
4. **Worth exploring** — a Patterned event with enough context to support a neutral follow-up.

Only the last category should enter the follow-up suggestion state.

### Speech Activity as Context

To handle dead-air and thinking moments more intelligently, the system may use a lightweight local **speech activity state** (for example, speaking / pause / resumed) as contextual input. This is not used to infer emotion, honesty, or intent. It is used only to avoid treating a short pause plus normal gaze aversion as an automatic reason to intervene.

Full speech transcription is not required for the core evidence gate. If speech activity is unavailable from the selected Source, the system falls back to stricter visual-only temporal thresholds and remains conservative.

---

## FR-005A — Local Speech Activity Context

**Priority:** P0

When audio is available from the selected Source, the system should maintain a lightweight local speech activity state such as:

- speaking,
- short pause / dead air,
- speech resumed.

The purpose is to provide temporal context for the visual evidence gate. It must not be used to infer emotion, honesty, discomfort, or intent.

Full transcription is not required for this requirement. If audio is unavailable, the system must fall back to stricter visual-only thresholds.

---

## FR-006 — Flag Engine

**Priority:** P0

The system must support four observation Flags:

- Looking off-screen
- Reading pattern
- Face missing
- Second face

Each Flag must include:

- timestamp,
- type,
- duration or occurrence context where available,
- Question association if a Question is active,
- supporting temporal evidence where available.

A Flag does not automatically become a follow-up suggestion. It must first pass the Adaptive Follow-Up Trigger / evidence gate.

---

## FR-007 — Question Tracking

**Priority:** P0

The Interviewer must be able to mark a new Question.

### Requirements

- Current Question is visible.
- Flags are associated with the Question active when the Flag starts.
- Questions appear in the Session Timeline.
- Question context is passed to the local LLM.

---

## FR-008 — Live Interview Dashboard

**Priority:** P0

The main Session screen must show:

- Session duration,
- Candidate video,
- current Question,
- local processing indicator,
- recent observations,
- Question controls,
- follow-up state.

### Design Principle

The interface should feel like an Interviewer assistant, not a surveillance dashboard.

Avoid:

- suspicion meters,
- red warning-heavy layouts,
- Candidate risk scores,
- cheating percentages.

---

## FR-009 — Explainable Flag

**Priority:** P0

The Interviewer must be able to inspect why a Flag was raised.

Example:

```text
LOOKING OFF-SCREEN

The Candidate's gaze moved outside
their usual gaze range for approximately 4 seconds.

Baseline:
Normal gaze → slightly below center

Observed:
Repeated movement → far right

This is an observation, not a conclusion.
```

The explanation must describe observable behavior and relevant thresholds without making a psychological conclusion.

---

## FR-010 — Moment Worth Exploring

**Priority:** P0

When a Flag and surrounding context satisfy the follow-up trigger, the UI may present:

> **Moment worth exploring**

The trigger must pass the evidence gate described in FR-005 and FR-011. A single gaze deviation, short dead-air period, or brief distraction must not be sufficient on its own.

The system should not use language such as:

- suspicious,
- cheating,
- lying,
- dishonest,
- uncomfortable,
- violation.

---

## FR-011 — Local Interviewer Note

**Priority:** P0

A local language model must generate a short Interviewer Note from:

- recent Flags,
- current Question,
- follow-up count,
- relevant observation context,
- the reason the evidence gate was satisfied.

The local LLM is a **language/recommendation layer**, not the primary detector. It must not decide from raw video whether the Candidate is suspicious, distracted, lying, or uncomfortable. Deterministic/local temporal logic establishes whether an observation is strong enough to surface; the LLM turns that grounded observation into neutral language.

The local LLM should **not receive raw Candidate video** as the primary input to this generation step.

### Example

> "A repeated reading-like gaze pattern appeared while discussing the project timeline. Consider asking for a specific example."

The Note must remain neutral and grounded in observations.

---

## FR-012 — Neutral Follow-up Generation

**Priority:** P0

The local LLM must generate a follow-up question that is:

- neutral,
- grounded in the current Question,
- specific enough to be useful,
- non-accusatory,
- short enough to ask naturally.

### Example

Instead of:

> "Were you reading something?"

Prefer:

> "Could you walk me through what you did in that situation?"

---

## FR-013 — Follow-up Quality Check

**Priority:** P1

Generated follow-ups should be evaluated against:

- **Specific**
- **Neutral**
- **Grounded**

Example:

```text
FOLLOW-UP QUALITY

Specific   ✓
Neutral    ✓
Grounded  ✓
```

The system should reject or regenerate questions that are accusatory, speculative, or unrelated to the current Question.

---

## FR-014 — Interviewer Override

**Priority:** P0

The Interviewer must remain in control.

Available actions:

- Ask Follow-up
- Continue
- Dismiss

The AI recommendation is advisory only.

---

## FR-015 — Follow-up Counter

**Priority:** P0

The UI must display the number of follow-ups used for the active Question.

Example:

> **Follow-up 1 / 2**

The system must enforce the limit server/application-side rather than relying only on UI state.

---

## FR-016 — Re-observation

**Priority:** P0

After a follow-up is asked, the system must resume analysis and evaluate whether the previously observed pattern settles.

---

## FR-017 — Automatic Stop Condition

**Priority:** P0

The system must stop suggesting additional follow-ups when:

- the pattern settles, or
- the maximum follow-up count is reached.

Example:

> **Observation settled ✓**  
> No further follow-up suggested.

---

## FR-018 — Session Timeline

**Priority:** P0

The system must record a timeline in memory containing:

- Question start,
- Flag,
- Follow-up,
- re-observation result,
- resolution/stop state.

Example:

```text
09:42  Question started
09:47  Moment worth exploring
09:49  Follow-up asked
09:51  Observation settled
```

---

## FR-019 — Question Journey

**Priority:** P1

The Interviewer can inspect a Question's journey:

```text
Question
   ↓
Observation
   ↓
Follow-up
   ↓
Re-observation
   ↓
Resolution
```

This should be more useful than a raw gaze heatmap.

---

## FR-020 — Session Report

**Priority:** P0

At Session end, the application must generate a summary organized by Question.

Example:

### Question 2

**Question:** Tell me about a difficult project.

**Moment explored:**  
A repeated reading-like gaze pattern was observed.

**Follow-up:**  
"Could you walk me through your role in that situation?"

**Result:**  
Pattern settled after follow-up.

The report must contain no Candidate images.

---

## FR-021 — PDF Export

**Priority:** P0

The Interviewer must be able to export the Session Report as a PDF.

The export should prioritize:

- Questions,
- observations,
- follow-ups,
- outcomes,
- timestamps.

It must not include hiring recommendations or Candidate scoring.

---

# 13. UX / Screen Requirements

## Screen 1 — Consent

### Purpose

Establish informed Consent before analysis begins.

### Elements

- Product name
- Short explanation of local gaze analysis
- Privacy statement
- Consent checkbox/confirmation
- Continue button

---

## Screen 2 — Source Selection

### Elements

- Online Interview / Assessment Window
- Local Webcam
- Local Video
- Source preview
- Start Baseline button

---

## Screen 3 — Baseline Learning

### Elements

- Candidate preview
- progress indicator
- "Learning Candidate Baseline"
- local processing indicator

### Completion

> **Baseline ready ✓**

---

## Screen 4 — Live Interview Dashboard

### Layout

```text
┌────────────────────────────────────────────────┐
│ Interview Assistant        ● Processing locally│
├───────────────────────┬────────────────────────┤
│                       │ CURRENT QUESTION       │
│                       │                        │
│    CANDIDATE VIDEO    │ Tell me about a        │
│                       │ difficult project...   │
│                       │                        │
│                       │ [ + New Question ]     │
├───────────────────────┴────────────────────────┤
│ RECENT                                          │
│ 09:47  Moment worth exploring                  │
│        Reading-like pattern                    │
│                                                 │
│        [ Continue ] [ Ask Follow-up ]          │
└────────────────────────────────────────────────┘
```

---

## Screen 5 — Flag Details

### Elements

- Flag type
- timestamp
- plain-language observation
- baseline comparison
- "This is an observation, not a conclusion."
- Dismiss / Explore actions

---

## Screen 6 — Follow-up State

### Example

```text
FOLLOW-UP 1 / 2

Suggested follow-up:

"Could you tell me more about how
you handled that situation?"

[ ASK FOLLOW-UP ]  [ CONTINUE ]
```

---

## Screen 7 — Resolution

### Settled

```text
OBSERVATION SETTLED ✓

No further follow-up suggested.

[ NEXT QUESTION ]
```

### Persisting

```text
PATTERN CONTINUES

One final follow-up is available.

Follow-up 1 / 2

[ ASK FINAL FOLLOW-UP ] [ CONTINUE ]
```

### Limit Reached

```text
FOLLOW-UP LIMIT REACHED

The assistant will stop suggesting
follow-ups for this Question.

[ NEXT QUESTION ]
```

---

## Screen 8 — Session Report

### Sections

- Session summary
- Question list
- Question Journey
- moments explored
- follow-ups used
- resolved observations
- unresolved/limited observations
- export PDF

---

# 13A. Connectivity Model

The product separates **interview transport** from **AI inference**.

| Component | Internet Required? |
|---|---|
| Existing online interview / assessment platform | Yes, if cloud-hosted |
| Google Meet / Zoom / Teams transport | Yes |
| Meeting-window capture | No additional AI cloud dependency |
| Local webcam | No |
| Local video source | No |
| Local vision inference | No |
| Baseline calculation | No |
| Flag engine | No |
| Local LLM | No |
| Follow-up generation | No |
| Re-observation / stop logic | No |
| Session timeline / report | No |

**Important:** If an online meeting loses internet connectivity, the remote Candidate feed may stop or freeze because the meeting transport itself depends on the network. The Local AI claim is not that the online meeting continues offline; it is that the AI analysis layer does not require cloud AI inference.

For the hackathon Offline Test, use **Local Webcam** or **Local Video** so the core Local AI pipeline can be demonstrated reliably after internet is disabled.

# 14. AI / System Architecture

```text
                 CANDIDATE VIDEO
                       │
                       ▼
              ┌─────────────────┐
              │ LOCAL VISION AI │
              └────────┬────────┘
                       │
                    Signals
                       │
                       ▼
             ┌──────────────────────────┐
             │ BASELINE + RULES         │
             │ + TEMPORAL LOGIC         │
             │ + SPEECH CONTEXT         │
             │ + EVIDENCE GATE          │
             └────────────┬─────────────┘
                          │
                   Flag / Worth Exploring
                          │
          ┌───────────────┴───────────────┐
          │                       │
          ▼                       ▼
    Timeline State          Current Question
          │                       │
          └───────────┬───────────┘
                      ▼
                ┌────────────┐
                │ LOCAL LLM  │
                └─────┬──────┘
                      │
             ┌────────┴─────────┐
             ▼                  ▼
      Interviewer Note     Follow-up
             │                  │
             └────────┬─────────┘
                      ▼
                INTERVIEWER
                      │
             Ask / Continue
                      │
                      ▼
                 RE-OBSERVE
                      │
                ┌─────┴─────┐
                ▼           ▼
             Settled     Persisting
                │           │
                ▼           ▼
            MOVE ON    Final Follow-up
                            │
                            ▼
                           STOP
```

---


# 14A. Model Selection & Hardware Strategy

The Local AI stack should be designed for **consumer laptops**, not workstation-class hardware. The goal is for stronger hardware to improve speed and responsiveness rather than determine whether the product is intelligent enough to function.

The AppBuildersPH rules do not require a specific model, framework, operating system, or hardware platform. They require that a meaningful part of AI inference executes locally and that the core Local AI functionality does not depend entirely on a cloud AI API.

## 14A.1 Proposed MVP Model Stack

| Layer | Proposed technology | Role | Invocation pattern |
|---|---|---|---|
| Face / landmark analysis | **MediaPipe Face Landmarker** | Local face landmarks and geometry used to derive gaze/head-direction Signals | Continuous, lightweight |
| Vision runtime | **ONNX Runtime** | Local model execution | Continuous vision path |
| GPU acceleration | **WebGPU when available** | Accelerates supported local inference | Opportunistic |
| CPU fallback | **WASM / CPU execution** | Keeps the vision path usable without a suitable GPU runtime | Automatic fallback |
| Local language model | **Qwen3 4B, quantized (initial target)** | Interviewer Notes and neutral follow-up generation | Event-driven, only after evidence gate |
| Lightweight fallback LLM | **Qwen3 1.7B, quantized** | Lower-memory fallback when the 4B model is too heavy for the available machine | Event-driven |

These are **initial implementation targets, not measured minimum requirements**. Final model selection must be validated through actual benchmarks on the team's demo hardware.

## 14A.2 Why the Vision Model Should Be Lightweight

The vision layer observes continuously, so it should not use a large multimodal model for every frame.

The intended path is:

```text
Candidate Video
      ↓
Lightweight Local Vision
      ↓
Signals
      ↓
Baseline + Temporal Rules
      ↓
Flag / Ignore
```

The system should sample frames at a manageable rate rather than process every camera frame. An initial target is approximately **5–10 FPS**, subject to benchmark results and model accuracy.

The product does not need a vision-language model to interpret the Candidate. The vision layer extracts structured Signals, while deterministic logic decides whether a pattern is meaningful enough to surface.

## 14A.3 Why the Local LLM Should Be Small and Event-Driven

The local language model does **not** need to continuously process video. It is invoked only after the evidence gate produces a meaningful observation.

```text
Video
  ↓
Local Vision
  ↓
Signals
  ↓
Temporal / Contextual Logic
  ↓
Evidence Gate
  ↓
Meaningful Flag
  ↓
Local LLM
  ↓
Interviewer Note / Follow-up
```

This reduces both compute demand and unnecessary generation. The LLM receives structured context such as the current Question, recent Flags, and follow-up count. It does not receive raw Candidate video as its primary input.

The MVP should **not** depend on:

- 8B+ language models as the default,
- large multimodal vision-language models,
- multiple simultaneous local LLMs,
- continuous LLM inference while the Candidate is speaking,
- cloud vision APIs for the core observation loop.

## 14A.4 Reference Development / Demo Hardware

The current development reference machine is:

- **CPU:** Intel Core i5
- **GPU:** NVIDIA GeForce RTX 4060 Laptop GPU
- **System RAM:** 8 GB

This machine is considered a practical **reference constraint for the MVP**, not a published minimum specification.

The RTX 4060 provides useful GPU acceleration for local inference. The more important constraint is the **8 GB system RAM**, because the operating system, browser or desktop shell, interview platform, vision pipeline, and local LLM may compete for memory.

Therefore the architecture should prioritize:

1. lightweight vision inference;
2. moderate frame sampling;
3. quantized local language models;
4. event-driven LLM invocation;
5. one local LLM at a time;
6. CPU/WASM fallback for supported vision execution;
7. graceful degradation when hardware acceleration is unavailable.

## 14A.5 Hardware-Aware Degradation

The product should follow this principle:

> **Hardware acceleration should make the assistant faster, not make the assistant fundamentally different.**

### Standard mode

Use the target vision pipeline with GPU acceleration when available and the Qwen3 4B quantized local LLM.

### Lightweight mode

If memory or latency is constrained:

- reduce vision sampling rate within acceptable limits;
- use CPU/WASM fallback where necessary;
- switch to the smaller Qwen3 1.7B quantized model;
- keep the same observation, evidence-gate, follow-up, and stop-condition logic.

### High-performance mode

If additional GPU resources are available, use them to reduce inference latency or increase throughput. Do not add unnecessary model complexity merely because the hardware allows it.

## 14A.6 Benchmark Plan

Before claiming a minimum hardware requirement, benchmark the complete pipeline on the reference laptop and at least one lower-spec machine if available.

Measure:

| Test | Metrics |
|---|---|
| Vision only | FPS, CPU usage, GPU usage, RAM, dropped frames |
| Vision + Dashboard | FPS, RAM, UI responsiveness |
| Vision + Local LLM | LLM load time, generation latency, RAM/VRAM |
| Full pipeline | end-to-end latency from meaningful pattern to follow-up |
| Lightweight fallback | same metrics using smaller model / CPU path |
| Offline mode | whether the core AI loop continues with internet disabled |

The benchmark should be run using the same demo scenario used for the hackathon. Results should be documented in the repository so hardware claims are evidence-based.

## 14A.7 Product Hardware Goal

The product goal is **consumer-laptop usability with graceful hardware degradation**, not a guarantee that every laptop can run every model.

The team should be able to state the actual tested configuration at submission time. The hackathon explicitly asks teams to disclose the hardware tested on, alongside models, frameworks, APIs, and what runs locally.

# 15. Local AI Boundary

## Must Run Locally

The following are core local functionality:

- Candidate video processing
- Vision inference
- Signal extraction
- Local speech activity context when audio is available
- Baseline calculation
- Flag generation
- Temporal/contextual evidence gating
- Local LLM Interviewer Notes
- Follow-up generation
- Resolution/stop reasoning where applicable

## Optional / Non-Core Cloud Components

Cloud services may be used for:

- deployment,
- authentication if needed,
- non-AI supporting infrastructure,
- optional telemetry that contains no sensitive Candidate video.

The core AI loop must not depend entirely on a cloud AI API.

---

# 15A. Integration Model

The MVP does not require a deep API integration with a third-party assessment platform. For the hackathon, integration can be represented through a captured interview/assessment window and interviewer-controlled Question markers. A future production integration could receive structured Question and Consent states from an assessment platform through an explicit connector/API.

The assistant must remain useful even when the surrounding platform is not AI-native: the key requirement is access to the Candidate video Source and the current Question context.

# 16. Privacy Architecture

Candidate video is sensitive.

The architecture should follow:

```text
Candidate Video
      ↓
Local Vision
      ↓
Signals
      ↓
Flags
      ↓
Local LLM
```

Raw Candidate video should not be sent to a cloud AI service for the core analysis.

The Session Report should contain observations and interview context, not Candidate images.

---

# 17. State Model

A Session can be modeled with:

```text
Session
├── Consent
├── Source
├── Baseline
├── Questions[]
│   ├── questionText
│   ├── startTime
│   ├── flags[]
│   ├── interviewerNotes[]
│   ├── followUps[]
│   ├── followUpCount
│   └── resolutionState
└── Report
```

### Suggested Question Resolution States

```text
NORMAL
OBSERVING
TRANSIENT
WORTH_EXPLORING
FOLLOW_UP_PENDING
FOLLOW_UP_ASKED
RE_OBSERVING
RESOLVED
PERSISTING
LIMIT_REACHED
```

---

# 18. Guardrails

## 18.1 Observation-Only Language

The system must use:

- "observed"
- "pattern"
- "moment worth exploring"
- "gaze moved"
- "face missing"
- "second face"
- "reading-like pattern"

Avoid:

- cheating
- dishonest
- lying
- suspicious
- violation
- discomfort
- deception
- candidate risk

unless explicitly discussing why the product does **not** make those judgments.

## 18.2 Interviewer Control

The AI cannot:

- ask follow-ups automatically,
- interrupt the interview,
- make a hiring decision,
- override the Interviewer.

## 18.3 Follow-up Budget

Maximum two follow-ups per Question.

## 18.4 Conservative Detection

A Flag should require a meaningful temporal pattern rather than a single noisy frame.

The system must explicitly account for normal interview behavior:

- thinking pauses,
- hesitant speech,
- brief gaze aversion,
- natural gaze shifts during speaking,
- temporary distraction,
- brief camera/face detection noise.

These should generally be treated as **observe/continue** states unless persistence or repetition causes them to meet a defined Flag threshold.

## 18.5 Precision-First Intervention

The assistant should optimize for **precision over frequency**. It should not try to surface every unusual observation. The preferred behavior when evidence is weak is: **continue observing**.

A follow-up suggestion should require a meaningful pattern plus enough Question context to produce a grounded, neutral question.

## 18.6 No Mental-State Inference

The system must not claim to know why a Candidate looked away. Gaze patterns may occur during ordinary speaking, hesitation, thinking, or turn-taking. The system reports observable patterns only.

## 18.7 No Candidate Scoring

No aggregate "Candidate quality" or "integrity" score.

---

# 19. Technical Reliability Strategy

Because the product depends on live vision analysis, reliability is more important than feature count.

## Priority Order

1. Stable video input
2. Reliable face detection
3. Stable gaze/head direction estimation
4. Robust baseline
5. Conservative temporal/context thresholds
6. Reliable distinction between transient behavior and persistent/repeated patterns
7. Local LLM generation with hardware-aware model selection
8. Follow-up state machine
9. Report/export

If time is limited, reduce feature scope rather than compromising the core loop.

---

# 20. Offline Test Plan

The AppBuildersPH hackathon explicitly includes an Offline Test where internet connectivity may be disabled and the team must demonstrate that the core Local AI functionality continues to operate.

## Demo Preparation

Before the event:

1. Download all local models.
2. Pre-cache model files.
3. Ensure no inference endpoint requires internet.
4. Test with Wi-Fi disabled.
5. Test with network adapter disabled where possible.
6. Prepare a known-good local demo path.

## Offline Demo

1. Start the Local AI Assistant while connected.
2. Choose **Local Video** or **Local Webcam** as the Source.
3. Demonstrate baseline learning.
4. Disable internet.
5. Continue local observation.
6. Trigger a known Flag.
7. Generate a local Interviewer Note.
8. Generate a neutral follow-up.
9. Re-observe.
10. Show resolution and continue the local Session flow.

### Important Clarification

Do **not** claim that Google Meet, Zoom, Teams, or another cloud interview transport continues working after internet is disabled. The Offline Test demonstrates that the **core Local AI layer** continues working without cloud AI inference.

### Desired statement

> **"The interview platform may use the internet. Our AI analysis layer does not need the cloud."**

---

# 21. Demo Scenario

## Question

> "Tell me about a difficult project you've worked on."

### Step 1 — Normal Moment

The Candidate pauses, looks slightly away while thinking, then continues answering.

The system observes a short isolated gaze deviation.

UI behavior:

> **Continue observing**

No Flag. No follow-up.

### Step 2 — Meaningful Pattern

Later in the same answer, a repeated reading-like gaze pattern appears across several moments. The pattern passes the temporal/contextual evidence gate.

### Step 3 — Surface

UI:

> **Moment worth exploring**

> A repeated reading-like gaze pattern was observed while answering this Question.

### Step 4 — Suggest

Local LLM:

> "Could you walk me through what you personally did in that situation?"

### Step 5 — Interviewer Decision

Interviewer selects:

> **Ask Follow-up**

### Step 6 — Re-observe

The system continues local observation.

### Step 7 — Resolve

UI:

> **Observation settled ✓**

> No further follow-up suggested.

### Step 8 — Move On

Interviewer clicks:

> **Next Question**

### Step 9 — Offline Test

Internet is disabled.

The system continues operating.

---

# 22. Hackathon Demo Narrative

The 5-minute pitch should prioritize a working product over a large slide deck.

## Suggested Structure

### 0:00–0:30 — Problem

> "Interview platforms are getting better at conducting and assessing interviews, but the human interviewer still has to listen, observe, and decide what is worth exploring."

### 0:30–0:55 — Differentiation

> "We aren't replacing the interview platform. We add a Local AI layer that helps the Interviewer notice moments worth exploring, suggests a neutral follow-up, re-observes what happens, and knows when to move on."

### 0:55–3:45 — Live Demo

Show:

1. Existing platform / interview setup
2. Consent confirmed
3. Baseline
4. Question
5. Flag
6. Neutral follow-up
7. Interviewer decision
8. Re-observation
9. Resolution
10. Next Question

### 3:45–4:30 — Local AI

Show architecture and explain:

- local vision,
- local baseline,
- local LLM,
- privacy,
- no cloud AI inference dependency in the core analysis loop.

### 4:30–5:00 — Offline Test

Use Local Webcam or Local Video, then disconnect internet.

> "The interview platform may use the internet. Our AI analysis layer does not need the cloud."

---

# 23. Success Metrics

## Product Success

- Interviewer can start a Session in under 1 minute.
- Consent is always completed before analysis.
- Baseline completes reliably.
- Brief/isolated gaze changes do not create follow-up suggestions.
- Normal thinking pauses and dead-air moments do not create follow-up suggestions.
- Flags appear only when temporal/context thresholds are met.
- Interviewer understands why a Flag appeared.
- Follow-up suggestions are neutral and relevant.
- Interviewer can always override the AI.
- Follow-up limit is enforced.
- Resolution state is understandable.
- Session Report is generated successfully.

## Technical Success

- Core vision inference works without internet when using a Local Webcam or Local Video Source.
- Local LLM works without internet.
- No cloud AI dependency exists in the core AI loop.
- Live processing is stable enough for a demo.
- A network interruption does not stop local AI processing when the Source itself remains locally available.

## Demo Success

A judge should understand within one minute:

1. Who the product is for.
2. What problem it solves.
3. What makes the AI local.
4. What makes it different from eye tracking/proctoring.
5. What happens when a moment is detected.

---

# 24. Hackathon Judging Alignment

The official judging criteria are:

| Criterion | Weight |
|---|---:|
| Problem & Usefulness | 25% |
| Local AI Implementation | 25% |
| Technical Execution | 20% |
| Innovation | 15% |
| Product & Demo Quality | 15% |

## Problem & Usefulness

The product has one clear user: the Interviewer.

It solves a realistic interview workflow problem: noticing and exploring moments without delegating judgment to AI.

## Local AI Implementation

Local AI is fundamental because:

- Candidate video is sensitive.
- Local inference reduces dependency on network connectivity.
- Vision processing runs on-device.
- Follow-up generation runs through a local LLM.
- The core loop can survive the Offline Test.

## Technical Execution

Technical depth comes from:

- local computer vision,
- baseline learning,
- temporal pattern detection,
- rule-based Flag generation,
- local LLM orchestration,
- bounded follow-up state,
- re-observation,
- resolution detection,
- report generation.

## Innovation

The differentiator is not eye tracking alone.

The product introduces a bounded workflow:

> **Observe → Explore → Re-observe → Resolve → Move On**

The AI assists the Interviewer without becoming the decision-maker.

## Product & Demo Quality

The product is highly demonstrable because the entire value proposition can happen in a short live interaction.

---

# 25. MVP Scope

## P0 — Must Ship

- [ ] Consent Gate
- [ ] Video Source Selection
- [ ] Local Vision Analysis
- [ ] Local Speech Activity Context / conservative fallback
- [ ] Automatic Baseline
- [ ] Four Flag Types
- [ ] Question Tracking
- [ ] Live Dashboard
- [ ] Explainable Flags
- [ ] Local Interviewer Note
- [ ] Local Follow-up Generation
- [ ] Interviewer Ask / Continue controls
- [ ] Follow-up Counter
- [ ] Re-observation
- [ ] Stop Condition
- [ ] Session Timeline
- [ ] Session Report
- [ ] PDF Export
- [ ] Offline Core AI Demo
- [ ] Hardware-aware local model selection
- [ ] Reference-hardware benchmark

## P1 — Build If Stable

- [ ] Follow-up Quality Check
- [ ] Question Journey visualization
- [ ] Improved baseline visualization
- [ ] More detailed local diagnostics
- [ ] Better report formatting
- [ ] Runtime model selector / lightweight mode
- [ ] Hardware performance diagnostics

## P2 — Post-Hackathon

- [ ] Multiple interview templates
- [ ] Custom interview question sets
- [ ] Richer Question Journey
- [ ] Additional non-invasive signals
- [ ] Advanced local model optimization
- [ ] Desktop packaging
- [ ] Hardware acceleration profiles
- [ ] Accessibility improvements

---

# 26. Explicitly Out of Scope for Hackathon MVP

Do not spend hackathon time building:

- candidate ranking,
- hiring recommendations,
- emotion recognition,
- personality classification,
- cheating probability,
- honesty probability,
- face recognition,
- cloud video storage,
- large analytics dashboards,
- unlimited follow-ups,
- automatic interviewing,
- complex multi-user account systems.

The MVP should optimize for a reliable, polished core loop.

---

# 27. Risks and Mitigations

### Hardware / Resource Constraints

**Risk:** An 8 GB RAM laptop may experience memory pressure when the interview platform, browser or desktop shell, vision pipeline, and local LLM run together.

**Mitigation:** Keep the vision model lightweight, sample frames at a controlled rate, invoke the LLM only after the evidence gate, use quantized models, provide a smaller LLM fallback, and benchmark the complete pipeline before claiming minimum hardware.


| Risk | Impact | Mitigation |
|---|---|---|
| Gaze model is noisy | High | Conservative temporal thresholds |
| False positives | High | Require sustained/repeated patterns |
| Local LLM is slow | High | Use small optimized model and constrained prompts |
| Offline model loading fails | High | Pre-cache and test before Demo Day |
| Follow-up is irrelevant | Medium | Ground generation in Question + Flags |
| UI feels like surveillance | High | Use neutral language and assistant-oriented design |
| AI makes unsupported claims | High | Strict observation-only prompt/UX guardrails |
| Demo environment changes | High | Prepare local webcam fallback |
| Model hardware incompatibility | High | Test on the exact demo machine |
| Too many features | High | Protect P0 scope |

---

# 28. Local LLM Prompt Contract

The local LLM should receive structured context rather than raw video.

### Input

```json
{
  "question": "Tell me about a difficult project.",
  "recent_flags": [
    {
      "type": "reading_pattern",
      "timestamp": "00:47",
      "description": "Repeated left-to-right gaze sweeps"
    }
  ],
  "follow_up_count": 0,
  "max_follow_ups": 2
}
```

### Expected Output

```json
{
  "moment_worth_exploring": true,
  "interviewer_note": "A repeated reading-like gaze pattern appeared while discussing the project.",
  "follow_up": "Could you walk me through what you personally did in that situation?",
  "quality": {
    "specific": true,
    "neutral": true,
    "grounded": true
  }
}
```

The model must not output:

```text
"The Candidate is cheating."
"The Candidate is lying."
"The Candidate is uncomfortable."
"The Candidate is dishonest."
```

---

# 29. Product Philosophy

## The AI should be helpful, not authoritative.

The product should feel like a quiet assistant sitting beside the Interviewer.

It should not constantly interrupt.

It should not turn every movement into an alert.

It should not make a judgment about the Candidate.

It should help the Interviewer notice something potentially useful, give them a reasonable question, and then get out of the way.

### Core principle

> **We don't react to every glance. We look for patterns worth exploring — and we know when to stop.**

---

# 30. Final Product Definition

### What are we building?

> **A Local AI Interview Assistant.**

### Who is it for?

> **Interviewers.**

### What does it do?

> **It observes Candidate gaze and face signals locally, learns a personal baseline, identifies patterns worth exploring, suggests neutral follow-up questions, re-observes after follow-up, and helps the Interviewer know when to move on.**

### What makes it different?

> **The AI doesn't judge the Candidate. It helps navigate the interview.**

### What makes it Local AI?

> **The core vision and language-model inference happen on-device, keeping sensitive Candidate video within the local environment and removing cloud AI inference from the core analysis loop. With a Local Webcam or Local Video Source, the core assistance loop can also continue without internet.**

### What is the product's signature interaction?

> **Observe → Understand → Follow Up → Re-observe → Resolve → Move On.**

### What is the product's signature line?

> **Notice. Follow up. Know when to move on.**

---

# Appendix A — Implementation Notes (current repo)

This appendix records where the repository stands against this PRD. The PRD body above is the source of truth; this appendix only tracks progress and the tested configuration so other docs and the code stay honest.

## Built

- Consent (Interviewer confirmation) — FR-001
- Source: Online Interview / Assessment Window, Local Webcam, and Local Video (P1, shown as Preview) — FR-002
- Local vision Signals via MediaPipe Face Landmarker in the browser (GPU, CPU fallback) — FR-003
- Automatic Baseline (first ~15 s) — FR-004
- Temporal Flag rules for the four Flag types, with Local Speech Activity Context (energy only; stricter thresholds when no audio track) — FR-005, FR-005A, FR-006
- Question marker (N key / Next question) — FR-007
- Live dashboard (video, current Question, Flags, local status, diagnostics panel) — FR-008
- Explainable Flag: Flag Details with Baseline vs observed, Explore and Dismiss — FR-009
- Adaptive Follow-Up Loop: Moment worth exploring (evidence gate), Ask / Continue / Dismiss, Follow-up counter (max 2), Re-observation, Stop condition, Session Timeline — FR-010, FR-014 – FR-018
- Event-driven Interviewer Note and neutral follow-up under the §28 contract, with local quality guard, one retry and deterministic fallback — FR-011 – FR-013
- Question Journey in the Session Report — FR-019
- Session Report with Markdown / JSON export — FR-020
- PDF export via the browser's print-to-PDF — FR-021
- Hardware-aware model selection (first installed of `qwen3:4b` → `qwen3:1.7b` → `qwen2.5:3b`) with step-down to a lighter model and a lower vision fps cap in lightweight mode — §14A.4, §14A.5
- Local LLM benchmark script (`npm run bench:llm`) and measured results in [BENCHMARK.md](./BENCHMARK.md) — §14A.6 (LLM rows)

## Not yet built

- Remaining §14A.6 benchmark rows (vision-only fps/CPU/GPU, vision + dashboard, full pipeline pattern → follow-up latency, offline pass/fail) — pending a manual run in the browser; see [BENCHMARK.md](./BENCHMARK.md)
- "Copy diagnostics" to clipboard from the diagnostics panel (BUILD_PLAN M11.2)
- Benchmark on a second, lower-spec machine (§14A.6)

## Tested configuration so far

- CPU: Intel Core i5-13420H
- GPU: NVIDIA GeForce RTX 3050 Laptop GPU, 4 GB
- System RAM: 7.7 GB
- Installed local LLM: `qwen2.5:3b` (Ollama)

This differs from the §14A reference machine and model targets, which §14A.1 describes as initial implementation targets, not measured minimum requirements. Performance figures are quoted only from measurements on this machine.
