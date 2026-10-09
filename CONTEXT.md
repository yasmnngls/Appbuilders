# Context

Glossary for the interview gaze-observation tool. Terms here are the canonical language for code, UI and pitch.

## Language

**Interviewer**:
The person running the interview and the only user of the app.
_Avoid_: user, proctor, admin

**Candidate**:
The person being interviewed, whose face the app observes. Never installs or sees the app.
_Avoid_: subject, applicant, user

**Session**:
One interview from Consent to End. Exists only in memory until the Interviewer exports it.
_Avoid_: recording, call, meeting

**Consent**:
The Interviewer's confirmation that the Candidate was told about on-device gaze analysis and agreed. A Session cannot start without it.

**Source**:
Where the Candidate's face comes from: a captured meeting window, or the local webcam.

**Question**:
A stretch of the Session that starts when the Interviewer marks a new interview question. Flags and Notes belong to the Question during which they happened.

**Signal**:
A raw measurement of the Candidate taken from one video frame (face count, head direction, gaze direction).
_Avoid_: data point, metric

**Baseline**:
The Candidate's normal gaze centre and natural wander, learned in the first seconds of a Session. Off-screen and reading are judged relative to it.
_Avoid_: calibration

**Flag**:
A time-stamped observation raised by a rule over Signals. An observation, never a verdict. Kinds:
- **Looking off-screen** — gaze held well outside the Baseline.
- **Reading pattern** — repeated left-to-right sweeps with quick returns, like reading lines of text.
- **Face missing** — no face visible.
- **Second face** — more than one face visible.
_Avoid_: alert, violation, cheating, detection

**Interviewer Note**:
A short plain-language summary of recent Flags, written by the local language model, often with a suggested follow-up question.
_Avoid_: insight, AI verdict

**Session Report**:
The end-of-Session summary per Question, exportable by the Interviewer. Contains no images.

## Relationships

- A **Session** has one **Consent**, one **Source**, at most one **Baseline**, and many **Questions**
- A **Flag** belongs to at most one **Question** (the one active when it started)
- **Interviewer Notes** are written from **Flags**, never directly from video

## Flagged ambiguities

- "Cheating" is never used: the app reports what the Candidate's eyes did, and the Interviewer decides what it means.
