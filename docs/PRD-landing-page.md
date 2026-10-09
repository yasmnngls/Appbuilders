# PRD — Landing Site

> Derived from [PRD-product.md](./PRD-product.md) v1.2 — if they disagree, PRD-product.md wins.
> Structure in [SITEMAP.md](./SITEMAP.md) §1; deployment in [ARCHITECTURE.md](./ARCHITECTURE.md) §1 and §8.

**Status:** Hackathon MVP · **Surface:** static marketing site, separate from the Interviewer App

---

## 1. Purpose

Explain the Local AI Interview Assistant to people who are not running it, and get them to the demo, the repository, or the run instructions.

The Landing Site is **not** the product. The product runs locally on the Interviewer's laptop; the Landing Site only describes it.

## 2. Goal

A Visitor should understand within one minute (PRD §23, "Demo success"):

1. who the product is for: Interviewers;
2. what problem it solves: noticing and exploring moments without handing judgment to AI;
3. what makes the AI local: vision and language models run on-device;
4. how it differs from eye tracking or proctoring: no verdicts, no scores, a bounded follow-up loop that knows when to stop;
5. what happens when a moment is detected: Observe → Explore → Re-observe → Resolve → Move On.

## 3. Audience

| Audience | Needs |
|---|---|
| Hackathon judges | A fast grasp of usefulness, local AI depth and the demo |
| Interviewers and hiring teams | What it does, what it doesn't do, privacy |
| Developers | Architecture, run steps, disclosures |

## 4. Content sections

Sections appear in the order of SITEMAP §1.

| Section | Content | Source in PRD |
|---|---|---|
| **Hero** | Name, tagline "Notice. Follow up. Know when to move on.", one-line pitch, CTAs: Watch demo · View on GitHub · Run it locally | §1.2, §1.3 |
| **Problem** | What an Interviewer juggles; useful moments get missed; monitoring tools over-judge | §3 |
| **How it works** | Observe → Explore → Re-observe → Resolve → Move On, with one line each; a visual of the follow-up card (Follow-up 1 / 2, Ask / Continue) | §1.4, §11 |
| **What it is not** | No Candidate score, no cheating or honesty probability, no emotion reading, no face recognition, no hiring recommendation, no automatic questions | §6, §26 |
| **Why local AI** | Candidate video is sensitive and stays on the laptop; real time with no upload; the core AI loop works without cloud AI | §15, §16, §24 |
| **Demo** | The ~1-minute demo video (embedded or linked) | §21 |
| **Architecture at a glance** | Simplified diagram: Video → Local Vision → Signals → Baseline + Rules + Evidence Gate → Local LLM → Interviewer | §14, ARCHITECTURE §2 |
| **Run it locally** | Requirements (Node 20+, Chrome/Edge, Ollama), commands, link to the README | README |
| **Disclosures** | Models, frameworks, APIs (none at runtime for the core loop), AI dev tools, tested hardware | §14A.7, PRD Appendix A |
| **Footer** | GitHub, demo video, X/LinkedIn post, #AppBuildersPH, MIT license | — |

### Required statements

- "The interview platform may use the internet. Our AI analysis layer does not need the cloud." (§20)
- "A Flag is an observation, never a verdict." (§7)

## 5. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| LP-001 | Static site: HTML, CSS and minimal JS; no backend, database, forms, sign-up or cookies | P0 |
| LP-002 | No analytics or tracking scripts | P0 |
| LP-003 | All CTAs work: demo video, GitHub repo, run instructions anchor | P0 |
| LP-004 | Responsive down to 360 px wide, with no horizontal scroll | P0 |
| LP-005 | Light and dark themes following the system setting | P1 |
| LP-006 | Loads fast: no heavy frameworks; images optimized; fonts self-hosted or system | P1 |
| LP-007 | Accessible: semantic headings, alt text, visible focus, sufficient contrast, respects reduced motion | P1 |
| LP-008 | Open Graph / social preview image and description for the X/LinkedIn post | P1 |

## 6. Content and language rules

- Follow the observation-only language of PRD §18.1. Words the product avoids appear only in the "What it is not" section, to say what it does **not** do.
- Never claim that Meet, Zoom or Teams keep working offline (§13A, §20).
- Quote only performance numbers measured on the tested hardware (§14A.6, §14A.7). Never invent benchmarks.
- Visual tone: a quiet assistant, not surveillance. No red alarm styling, risk meters or "caught" imagery (FR-008).

## 7. Technical approach

- Lives in `landing/` in the same repository; built with Vite (plain HTML + Tailwind) and deployed separately to static hosting (e.g. Vercel).
- It shares no code or runtime with the Interviewer App, and never loads the vision model or talks to Ollama.

## 8. Acceptance criteria

- [ ] A first-time Visitor can answer the five questions in §2 after one minute on the page.
- [ ] Every CTA resolves (demo video, GitHub, run steps).
- [ ] No network requests beyond the page's own assets and the embedded video.
- [ ] Banned words appear only in the "What it is not" section.
- [ ] The offline claim is scoped to the AI layer, never the meeting transport.
- [ ] Renders correctly at 360 px, 768 px and 1440 px, in light and dark.

## 9. Non-goals

- A hosted or web version of the Interviewer App
- Sign-up, waitlist, accounts or contact forms
- Any Candidate data, uploads or demos that process a visitor's camera
- Pricing, blog or multi-page marketing
