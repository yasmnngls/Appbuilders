import { FLAG_LABELS, type Flag, type Session, type SessionTime } from "../domain/types";

/** Session time as "m:ss". */
export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const overlaps = (f: Flag, fromT: SessionTime, toT: SessionTime) => f.start <= toT && (f.end ?? Infinity) >= fromT;

/** One plain-text line per Flag, e.g. "- Looking off-screen, 0:12–0:16 (4s), during Q2 "Tell me about…": gaze to the left". */
export function describeFlag(session: Session, f: Flag, nowT: SessionTime): string {
  const q = session.questions.find((q) => q.id === f.questionId);
  const end = f.end ?? nowT;
  const secs = Math.max(0, Math.round((end - f.start) / 1000));
  const range = `${formatTime(f.start)}–${f.end === null ? "ongoing" : formatTime(f.end)}`;
  const question = q ? `, during Q${q.number} "${q.label}"` : "";
  const detail = f.detail ? `: ${f.detail}` : "";
  return `- ${FLAG_LABELS[f.kind]}, ${range} (${secs}s${f.end === null ? " so far" : ""})${question}${detail}`;
}

/** Bullet list of Flags overlapping [fromT, toT]; ongoing Flags count as still happening. Empty string if none. */
export function describeFlags(session: Session, fromT: SessionTime, toT: SessionTime): string {
  return session.flags
    .filter((f) => overlaps(f, fromT, toT))
    .map((f) => describeFlag(session, f, toT))
    .join("\n");
}
