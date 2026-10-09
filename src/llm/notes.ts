import { FLAG_LABELS, type Flag, type Session, type SessionTime } from "../domain/types";
import { chatJSON } from "./ollama";

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

export const NOTE_SYSTEM = `You assist a job interviewer. An on-device tool raises Flags: neutral, time-stamped observations of where the Candidate's eyes and face were (Looking off-screen, Reading pattern, Face missing, Second face).
Write an Interviewer Note:
- "text": at most 2 short sentences stating what the Candidate's eyes or face did, referencing the question by number (e.g. "During Q2 ..."). Plain facts only. Do not guess why it happened, do not judge honesty or intent, do not use words like cheating, lying, violation or suspicious.
- "followUp": one natural follow-up question for the Candidate about the topic of that question, which asks for personal specifics or reasoning they could not have prepared notes for. Use null if no follow-up fits.`;

const NOTE_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" }, followUp: { type: ["string", "null"] } },
  required: ["text", "followUp"],
};

/** Ask the local model for an Interviewer Note on the Flags in [fromT, toT]. Null (no LLM call) if there are none. */
export async function generateNote(
  session: Session,
  fromT: SessionTime,
  toT: SessionTime,
  signal?: AbortSignal,
): Promise<{ text: string; followUp: string | null } | null> {
  const flags = describeFlags(session, fromT, toT);
  if (!flags) return null;
  const user = `Window: ${formatTime(fromT)}–${formatTime(toT)} of the Session.\nFlags in this window:\n${flags}`;
  const out = await chatJSON<{ text?: unknown; followUp?: unknown }>(NOTE_SYSTEM, user, NOTE_SCHEMA, signal);
  const text = typeof out.text === "string" ? out.text.trim() : "";
  if (!text) throw new Error("Ollama returned an empty note");
  const followUp = typeof out.followUp === "string" && out.followUp.trim() ? out.followUp.trim() : null;
  return { text, followUp };
}

export interface NoteLoopOptions {
  intervalMs?: number;
  getSession: () => Session | null;
  /** Current Session time in ms. */
  now: () => number;
  onNote: (n: { t: number; questionId: string | null; text: string; followUp?: string }) => void;
  onStatus: (s: "ready" | "busy" | "unavailable") => void;
}

/** Every intervalMs, write a Note covering the Flags since the last successful one. Calls never overlap. Returns stop(). */
export function startNoteLoop(opts: NoteLoopOptions): () => void {
  let lastT = 0;
  let busy = false;
  let stopped = false;
  const controller = new AbortController();

  const tick = async () => {
    if (busy || stopped) return;
    const session = opts.getSession();
    if (!session) return;
    const t = opts.now();
    busy = true;
    opts.onStatus("busy");
    try {
      const note = await generateNote(session, lastT, t, controller.signal);
      if (stopped) return;
      lastT = t;
      if (note) {
        const questionId = session.questions[session.questions.length - 1]?.id ?? null;
        opts.onNote({ t, questionId, text: note.text, ...(note.followUp ? { followUp: note.followUp } : {}) });
      }
      opts.onStatus("ready");
    } catch {
      if (!stopped) opts.onStatus("unavailable");
    } finally {
      busy = false;
    }
  };

  const id = setInterval(tick, opts.intervalMs ?? 30000);
  return () => {
    stopped = true;
    clearInterval(id);
    controller.abort();
  };
}
