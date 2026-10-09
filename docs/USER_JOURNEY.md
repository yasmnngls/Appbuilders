# User Journey — Local AI Interview Assistant

> Derived from [PRD-product.md](./PRD-product.md) v1.2 — if they disagree, PRD-product.md wins.
> Screens are named as in [SITEMAP.md](./SITEMAP.md); states as in [ARCHITECTURE.md](./ARCHITECTURE.md) §3.3.

## Actors

- **Interviewer:** the only user of the app.
- **Candidate:** observed only after Consent. Never installs or operates the app.
- **Visitor:** a judge or reader who arrives on the Landing Site.

---

## 1. Before the interview (one-time setup)

1. Install Node 20+, Chrome or Edge, and Ollama.
2. While online, pull the local model (`ollama pull qwen2.5:3b`; `qwen3:4b` or `qwen3:1.7b` are used automatically if installed), then `npm install`.
3. `npm run dev` opens the app at `http://localhost:5173`. The vision model loads from local files, the status bar shows "Vision on GPU" (or CPU) and "Local LLM ready".
4. For an offline-capable session (PRD §20), test once with Wi-Fi off using Local Webcam or Local Video.

---

## 2. Main journey

The PRD §10 flow, step by step.

| # | Step | Interviewer sees | Interviewer does | System does (locally) |
|---|---|---|---|---|
| 1 | **Consent** (Screen 1) | Explanation, privacy statement, read-aloud script | Reads the script to the Candidate, enters their name, ticks Consent, Continue | Records the consent time. No observation yet |
| 2 | **Source** (Screen 2) | Window / Webcam / Local Video options, preview, audio indicator | Picks a Source; in window mode drags a box around the Candidate tile; Start Baseline | Opens the stream; starts the Session with Q1 "Introduction" |
| 3 | **Baseline** (Screen 3) | "Learning Candidate Baseline", progress | Starts with small talk | Learns the gaze centre and natural spread (~15 s) → "Baseline ready ✓" |
| 4 | **Ask a Question** (Screen 4) | Current Question, Session clock | Presses **N** (optionally types a label) for each new interview question | New Question; gate grace period (10 s) starts; follow-up state resets to `observing` |
| 5 | **Ordinary moment** | Nothing new | Keeps interviewing | A brief glance, thinking pause or face blip is ignored, or remains a transient "continue observing" |
| 6 | **Flag** | A neutral entry in Recent (e.g. "Looking off-screen · 0:42 · 4s") | May open **Flag Details** (Overlay 5) to see Baseline vs observed | Raises a Flag when a temporal rule threshold is met |
| 7 | **Moment worth exploring** (Card 6, `worth_exploring`) | "Moment worth exploring", Interviewer Note, suggested follow-up, Follow-up 1 / 2 | Chooses **Ask Follow-up**, **Continue** or **Dismiss** | The evidence gate opened; the local LLM wrote a Note and a neutral follow-up (fallback text if the LLM is unavailable) |
| 8a | **Ask** | "Re-observing…" (`re_observing`) | Asks the follow-up in their own words | Spends 1 follow-up; re-observes for 30 s |
| 8b | **Continue** | Card closes | Carries on | Budget unchanged; observing resumes from now |
| 8c | **Dismiss** | Card closes (`dismissed`) | Carries on | No more suggestions this Question |
| 9a | **Settled** (Card 7, `settled`) | "Observation settled ✓ No further follow-up suggested." | Next Question (N) | No trigger during re-observation; stops suggesting |
| 9b | **Persisting** (Card 7, `persisting`) | "Pattern continues. One final follow-up is available." · Follow-up 1 / 2 | Ask final follow-up, or Continue | A trigger fired again; the LLM writes the final follow-up |
| 10 | **Limit reached** (Card 7, `limit_reached`) | "Follow-up limit reached." | Next Question (N) | After 2 follow-ups, stops suggesting for this Question |
| 11 | **End** | — | **End session** | Stops capture; closes open Flags; the local LLM writes the Session Report |
| 12 | **Report** (Screen 8) | Summary, Question Journeys, Flags, Timeline | Reviews | — |
| 13 | **Export** | — | **Export PDF** (or Markdown / JSON), then **New session** | Downloads text only, with no images. Nothing else was stored |

Every step from 4 to 10 appends to the **Session Timeline**, for example:

```text
09:42  Question started — Q2 "Tell me about a difficult project"
09:47  Moment worth exploring — reading-like pattern
09:49  Follow-up asked (1 / 2)
09:51  Observation settled
```

---

## 3. Alternate paths

| Situation | What the Interviewer sees | Behaviour |
|---|---|---|
| Local LLM unavailable | "Local LLM unavailable" in the status bar | Flags, gate and follow-up loop still work; Notes and follow-ups use deterministic fallback text; the report uses the fallback summary |
| Slow LLM | Status shows the lighter model | Steps down to the next smaller installed model (lightweight mode) |
| No audio from the Source | "Speech context unavailable" | Stricter visual-only gate thresholds (FR-005A) |
| Candidate leaves the frame | Face missing Flag after 2 s; a Moment only if held ≥ 5 s | Baseline is unaffected |
| Second person appears | Second face Flag after 1 s; a Moment only if held ≥ 3 s | — |
| Candidate tile moves (window mode) | Select the tile again | The crop changes and the Baseline is re-learned |
| Meeting window closed / sharing stopped | Session ends | The report is generated from what was observed |
| Wi-Fi off | Status shows "Offline" | Webcam / Local Video keep working end to end; an online meeting feed may freeze because its transport needs internet |
| Interviewer disagrees with a suggestion | — | Continue or Dismiss. The AI is advisory only (FR-014) |

---

## 4. Worked example (PRD §21 demo scenario)

**Q2 is "Tell me about a difficult project you've worked on."**

1. **Normal moment:** the Candidate pauses, glances away while thinking, then resumes. The system ignores it: there is a single short deviation inside a thinking pause. There is no Flag and no follow-up.
2. **Meaningful pattern:** later in the answer, a repeated reading-like gaze pattern appears and a Reading pattern Flag is raised. The evidence gate opens.
3. **Surface:** the dashboard shows "Moment worth exploring" and the Note "A repeated reading-like gaze pattern was observed while answering Q2."
4. **Suggest:** the local LLM suggests "Could you walk me through what you personally did in that situation?" with Follow-up 1 / 2.
5. **Decide:** the Interviewer clicks **Ask Follow-up** and asks it.
6. **Re-observe:** the system watches for 30 s.
7. **Resolve:** "Observation settled ✓ No further follow-up suggested."
8. **Move on:** the Interviewer presses **N** for the next Question.
9. **Offline test:** Wi-Fi is turned off and the session continues with Local Webcam.

---

## 5. Visitor journey (Landing Site)

```text
Lands on hero ──▶ reads problem / how it works / what it is not
             ──▶ watches the ~1 min demo
             ──▶ reads "Why local AI"
             ──▶ View on GitHub ──▶ README run steps ──▶ runs the app locally
```

**Goal:** within one minute the Visitor knows who it is for, what problem it solves, what makes it local, and how it differs from proctoring (PRD §23).

---

## 6. Candidate's perspective

- **Told at Consent:** the Interviewer uses an on-device assistant that observes gaze and face direction. Nothing is recorded. It does not judge them.
- **Never happens:**
  - no install;
  - no images or video stored;
  - no scores or hiring recommendations;
  - no face recognition;
  - no automatic questions from the AI.
- **What the Interviewer may ask:** a normal follow-up question about the topic. Questions about where they were looking are excluded by design (FR-012).

---

## 7. Language guardrail

All screens, Notes, follow-ups and reports describe observations only ("observed", "pattern", "moment worth exploring"). Words the product never uses about a Candidate are listed in PRD §18.1.
