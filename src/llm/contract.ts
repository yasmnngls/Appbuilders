import { MAX_FOLLOW_UPS, type Flag, type FlagKind, type Moment, type Session } from "../domain/types";
import { describeFlag, formatTime } from "./notes";

/** PRD §28 input. Built from Flags and the gate reason only: never video, images or landmarks. */
export interface ContractInput {
  question: string;
  recent_flags: { type: "off_screen" | "reading_pattern" | "face_missing" | "second_face"; timestamp: string; description: string }[];
  follow_up_count: number;
  max_follow_ups: number;
  gate_reason: string;
  final: boolean;
}
/** PRD §28 output. */
export interface ContractOutput {
  moment_worth_exploring: boolean;
  interviewer_note: string;
  follow_up: string;
  quality: { specific: boolean; neutral: boolean; grounded: boolean };
}

export const UNLABELLED_QUESTION = "(not labelled — a general interview question)";
const RECENT_WINDOW_MS = 60_000;
const MAX_FLAGS = 6;

const TYPE: Record<FlagKind, ContractInput["recent_flags"][number]["type"]> = {
  "off-screen": "off_screen",
  "reading-pattern": "reading_pattern",
  "face-missing": "face_missing",
  "second-face": "second_face",
};

/** The Question text sent to the model: Q1's default is "Introduction", other default labels are sent as unlabelled. */
export function questionText(label: string, number: number): string {
  const isDefault = /^question\s*\d+$/i.test(label.trim()) || !label.trim();
  if (number === 1 && (isDefault || /^introduction$/i.test(label.trim()))) return "Introduction";
  return isDefault ? UNLABELLED_QUESTION : label.trim();
}

/** Flag description without the bullet, question and times (those are sent separately). */
function flagDescription(session: Session, f: Flag, nowT: number): string {
  return describeFlag({ ...session, questions: [] }, f, nowT).replace(/^- /, "");
}

export function buildContractInput(session: Session, moment: Moment): ContractInput {
  const q = session.questions.find((x) => x.id === moment.questionId);
  const byId = new Map(session.flags.map((f) => [f.id, f]));
  const own = moment.flagIds.map((id) => byId.get(id)).filter((f): f is Flag => !!f);
  const others = session.flags
    .filter(
      (f) =>
        !moment.flagIds.includes(f.id) &&
        !f.dismissed &&
        f.questionId === moment.questionId &&
        f.start <= moment.t &&
        (f.end ?? moment.t) >= moment.t - RECENT_WINDOW_MS,
    )
    .sort((a, b) => b.start - a.start)
    .slice(0, 5);
  const flags = [...own, ...others].slice(0, MAX_FLAGS);
  const used = session.followUp.questionId === moment.questionId ? session.followUp.used : Math.max(0, moment.followUpNumber - 1);
  return {
    question: q ? questionText(q.label, q.number) : UNLABELLED_QUESTION,
    recent_flags: flags.map((f) => ({ type: TYPE[f.kind], timestamp: formatTime(f.start), description: flagDescription(session, f, moment.t) })),
    follow_up_count: used,
    max_follow_ups: MAX_FOLLOW_UPS,
    gate_reason: moment.reason,
    final: moment.followUpNumber >= MAX_FOLLOW_UPS,
  };
}

/** JSON schema passed to Ollama as `format`. */
export const CONTRACT_SCHEMA = {
  type: "object",
  properties: {
    moment_worth_exploring: { type: "boolean" },
    interviewer_note: { type: "string" },
    follow_up: { type: "string" },
    quality: {
      type: "object",
      properties: { specific: { type: "boolean" }, neutral: { type: "boolean" }, grounded: { type: "boolean" } },
      required: ["specific", "neutral", "grounded"],
    },
  },
  required: ["moment_worth_exploring", "interviewer_note", "follow_up", "quality"],
} as const;

/** System prompt (PRD §28). Written with observation-only words; the rules are stated positively. */
export const CONTRACT_SYSTEM = `You help a job interviewer during a live interview. You write only for the interviewer, never for the candidate.
Input: the interview question, recent observations of the candidate's gaze and face, and why this moment is worth exploring.
Reply with JSON:
- "interviewer_note": ONE short sentence (under 25 words) saying what was observed and in which question, e.g. "A reading-like gaze pattern was observed during Q2 (the project question)." Use the observation of the FIRST flag: reading_pattern = "reading-like gaze pattern", off_screen = "gaze moved outside the usual range", face_missing = "face out of view", second_face = "a second face was visible". State facts only, with no reasons and no opinions.
- "follow_up": ONE question, 8 to 20 words, ending with "?". It asks about the TOPIC of the interview question and uses a key word from it, asking for the candidate's own concrete experience, e.g. "Could you walk me through how you personally handled the hardest part of that project?". It talks only about the topic: never about eyes, looking, the screen, the camera, notes, reading or other people.
- "moment_worth_exploring": true, and "quality": {"specific": true, "neutral": true, "grounded": true}.
If the question is not labelled, the follow-up stays general, e.g. "Could you walk me through a specific example of what you just described?".
If "final" is true, the follow-up asks for one specific example, step by step.
Keep a calm, respectful, neutral tone.`;

const OBSERVED: Record<ContractInput["recent_flags"][number]["type"], string> = {
  reading_pattern: "a reading-like gaze pattern",
  off_screen: "gaze moved outside the usual range",
  face_missing: "the face was out of view",
  second_face: "a second face was visible",
};

/** The user message for one Moment: the question number and main observation, then the contract input as JSON. */
export function contractUserMessage(input: ContractInput, questionNumber: number | null): string {
  const main = input.recent_flags[0];
  const head = [
    questionNumber === null ? null : `This is Q${questionNumber}.`,
    main ? `Main observation for the note: ${OBSERVED[main.type]}.` : null,
  ].filter(Boolean);
  return `${head.join(" ")}
${JSON.stringify(input)}`;
}
