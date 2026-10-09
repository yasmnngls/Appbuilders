# Sitemap — Local AI Interview Assistant

> Derived from [PRD-product.md](./PRD-product.md) v1.2 — if they disagree, PRD-product.md wins.

There are two surfaces: the **Landing Site** (static, hosted) and the **Interviewer App** (local, localhost). See [ARCHITECTURE.md](./ARCHITECTURE.md) §1.

---

## 1. Landing Site

This is a single page with anchor sections. The content spec is in [PRD-landing-page.md](./PRD-landing-page.md).

```text
/ (index.html)
├── #hero            Tagline, one-line pitch, CTAs: Watch demo · View on GitHub · Run it locally
├── #problem         What the Interviewer has to juggle
├── #how-it-works    Observe → Explore → Re-observe → Resolve → Move On
├── #not             What it is not: no scores, no verdicts, no emotion reading
├── #why-local       Privacy, real time, works without cloud AI
├── #demo            Demo video (~1 min)
├── #architecture    Architecture at a glance
├── #run             Requirements + run steps
├── #disclosures     Models, frameworks, AI tools, tested hardware
└── footer           GitHub · demo video · X/LinkedIn post · #AppBuildersPH · license
```

External links: the GitHub repository, the demo video, and the X/LinkedIn launch post.

---

## 2. Interviewer App

This is a single-page app at `http://localhost:5173` with no URL routing. Screens follow PRD §13 in order. The Interviewer moves forward only; going back means starting a new Session.

```text
1 Consent ──▶ 2 Source ──▶ 3 Baseline ──▶ 4 Live Interview Dashboard ──▶ 8 Session Report
                                            ├── 5 Flag Details     (overlay)
                                            ├── 6 Follow-up State  (card)
                                            └── 7 Resolution       (card)
```

Status bar on every screen: vision status (GPU/CPU), fps, local LLM status and model, speech context, online/offline.

### Screen 1: Consent
- **Purpose:** establish informed Consent before any analysis (FR-001).
- **Entry:** app opened, or "New session" chosen from the Report.
- **Elements:**
  - product name and tagline;
  - a short explanation of on-device gaze analysis;
  - the privacy statement;
  - a script to read aloud to the Candidate;
  - the Candidate's name;
  - a required consent checkbox;
  - **Continue**.
- **Exit:** Continue, enabled only when Consent is ticked. The consent time is recorded.

### Screen 2: Source Selection
- **Purpose:** choose where the Candidate's face comes from (FR-002).
- **Elements:**
  - Source options: **Online Interview / Assessment Window**, **Local Webcam**, and **Local Video** (P1);
  - a source preview;
  - a crop box over the Candidate tile (window mode);
  - an audio availability indicator;
  - **Start Baseline**.
- **Exit:** Start Baseline. The Session starts and Q1 "Introduction" is created.

### Screen 3: Baseline Learning
- **Purpose:** learn the Candidate's normal gaze (FR-004).
- **Elements:** Candidate preview, "Learning Candidate Baseline" with a progress indicator, and the local processing indicator.
- **Exit:** automatic, after ~15 s of tracked face. "Baseline ready ✓" then leads to the Live Interview Dashboard.
- **Note:** in the build, the Baseline progress appears over the video, so Screens 3 and 4 share the video panel.

### Screen 4: Live Interview Dashboard
- **Purpose:** run the interview with quiet assistance (FR-007, FR-008).
- **Elements:**
  - Candidate video;
  - Session duration;
  - **Current Question** with "+ New Question" (hotkey **N**) and an optional label;
  - "● Processing locally";
  - **Recent** observations (Flags);
  - the follow-up state;
  - Reset baseline;
  - **End session**.
- **Design rule:** an assistant, not surveillance. No risk meters, red alarm styling or scores.

### Overlay 5: Flag Details
- **Purpose:** explain why a Flag was raised (FR-009).
- **Elements:**
  - Flag type and timestamp;
  - a plain-language observation;
  - the Baseline comparison (normal vs observed);
  - the threshold;
  - "This is an observation, not a conclusion.";
  - **Dismiss** and **Explore**.

### Card 6: Follow-up State
- **Purpose:** present a Moment worth exploring and its suggested follow-up (FR-010 – FR-015).
- **State:** `worth_exploring`, or `persisting` for the final follow-up.
- **Elements:**
  - "Moment worth exploring";
  - the Interviewer Note;
  - the suggested follow-up;
  - Follow-up n / 2;
  - **Ask Follow-up**, **Continue**, **Dismiss**;
  - the quality check, Specific / Neutral / Grounded (P1).

### Card 7: Resolution
- **Purpose:** show the outcome of re-observation (FR-016, FR-017).
- **Variants:**
  - **Re-observing…** (`re_observing`)
  - **Observation settled ✓**: no further follow-up suggested; **Next Question** (`settled`)
  - **Pattern continues**: one final follow-up is available, Follow-up 1 / 2; **Ask final follow-up** or **Continue** (`persisting`)
  - **Follow-up limit reached**: no more suggestions this Question; **Next Question** (`limit_reached`)

### Screen 8: Session Report
- **Purpose:** review the Session and export it (FR-018 – FR-021).
- **Elements:**
  - session summary (consent time, Source, length);
  - the per-Question Question Journey: Question → Moment explored → Follow-up → Result;
  - Flags per Question;
  - the Session Timeline;
  - **Export PDF**, **Export Markdown**, **Export JSON**;
  - **New session**;
  - the privacy footer.
- **Never shown:** images, scores, hiring recommendations.

---

## 3. Alignment notes

The current build (see [PRD-product.md Appendix A](./PRD-product.md#appendix-a--implementation-notes-current-repo)) combines Screens 1 and 2 into one setup screen and does not yet have Overlay 5, Cards 6–7 or PDF export. This sitemap is the target; the code will be aligned to it.
