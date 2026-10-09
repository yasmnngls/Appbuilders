/** Milliseconds since the Session started. */
export type SessionTime = number;

/** One raw measurement of the Candidate, taken from a single video frame. */
export interface Signal {
  t: SessionTime;
  faceCount: number;
  /** Head rotation in degrees; positive yaw = Candidate turns to their left (our right). Null when no face. */
  headYaw: number | null;
  headPitch: number | null;
  /** Iris offset inside the eye, roughly -1..1; null when no face. */
  irisX: number | null;
  irisY: number | null;
  /** Estimated gaze direction in degrees (head pose + iris offset). Null when no face. */
  gazeX: number | null;
  gazeY: number | null;
}

/** The Candidate's normal gaze centre and natural wander, learned at the start of a Session. */
export interface Baseline {
  centreX: number;
  centreY: number;
  spreadX: number;
  spreadY: number;
}

export type FlagKind = "off-screen" | "reading-pattern" | "face-missing" | "second-face";

export const FLAG_LABELS: Record<FlagKind, string> = {
  "off-screen": "Looking off-screen",
  "reading-pattern": "Reading pattern",
  "face-missing": "Face missing",
  "second-face": "Second face",
};

/** A time-stamped observation raised by a rule. Never a verdict. */
export interface Flag {
  id: string;
  kind: FlagKind;
  start: SessionTime;
  /** Null while the Flag is still ongoing. */
  end: SessionTime | null;
  questionId: string | null;
  detail?: string;
  /** Why the Flag was raised, for Flag Details (FR-009). */
  evidence?: FlagEvidence;
  /** The Interviewer dismissed this Flag in Flag Details; it no longer counts toward the evidence gate. */
  dismissed?: boolean;
}

/** Observable measurements behind a Flag (FR-009). Degrees; direction is as seen by the Interviewer. */
export interface FlagEvidence {
  baseline?: Baseline;
  /** Off-screen: threshold used, and the largest deviation from the baseline centre while the Flag was active. */
  thresholdDeg?: { x: number; y: number };
  peakDeviationDeg?: number;
  direction?: "left" | "right" | "up" | "down";
  /** Reading pattern: line sweeps counted in the window. */
  cycles?: number;
  /** Second face: most faces seen. */
  faceCount?: number;
}

export interface Question {
  id: string;
  /** 1-based number shown as Q1, Q2... */
  number: number;
  label: string;
  start: SessionTime;
}

/** Most follow-ups the assistant will suggest within one Question (PRD §11.2). */
export const MAX_FOLLOW_UPS = 2;

/** Live speech-activity context from the Source's audio. Used only to discount thinking pauses, never to infer state. */
export type SpeechState = "speaking" | "pause" | "unavailable";

/** A contiguous stretch with no speech; end is null while the pause is ongoing. */
export interface Pause {
  start: SessionTime;
  end: SessionTime | null;
}

/**
 * A Moment worth exploring: a Flag pattern that passed the evidence gate during a Question.
 * Carries the locally generated Interviewer Note and suggested follow-up, and what the Interviewer did with it.
 */
export interface Moment {
  id: string;
  questionId: string;
  t: SessionTime;
  kind: FlagKind;
  /** "gate" = opened by the evidence gate; "interviewer" = opened from Flag Details → Explore. */
  origin: "gate" | "interviewer";
  /** Why the gate opened, in plain observable terms, e.g. "3 off-screen glances within 60s". */
  reason: string;
  flagIds: string[];
  /** 1-based follow-up slot this Moment would use if asked. */
  followUpNumber: number;
  /** Interviewer Note (FR-011). Null while the local LLM is writing. */
  note: string | null;
  followUp: string | null;
  quality: { specific: boolean; neutral: boolean; grounded: boolean } | null;
  suggestion: "generating" | "llm" | "fallback";
  decision: "pending" | "asked" | "continued" | "dismissed";
  askedAt: SessionTime | null;
  /** Re-observation outcome after the follow-up was asked. */
  result: "settled" | "persisting" | null;
}

/** Where a Question stands in the Adaptive Follow-Up Loop (PRD §17). */
export type FollowUpPhase =
  | "observing"
  | "worth_exploring"
  | "re_observing"
  | "settled"
  | "persisting"
  | "limit_reached"
  | "dismissed";

export interface FollowUpState {
  questionId: string;
  phase: FollowUpPhase;
  /** Follow-ups asked in this Question. Never exceeds MAX_FOLLOW_UPS. */
  used: number;
  /** End of the current re-observation window, if re-observing. */
  reObserveUntil: SessionTime | null;
  /** The Moment currently shown to the Interviewer, if any. */
  momentId: string | null;
  /** The Moment whose follow-up is being re-observed; receives the settled/persisting result. */
  askedMomentId: string | null;
  /** Flags that started before this time no longer count toward the evidence gate. */
  watchFrom: SessionTime;
}

export type TimelineKind =
  | "question"
  | "flag"
  | "moment"
  | "follow-up-asked"
  | "continued"
  | "dismissed"
  | "settled"
  | "persisting"
  | "limit-reached"
  | "session-end";

export interface TimelineEvent {
  t: SessionTime;
  kind: TimelineKind;
  questionId: string;
  text: string;
}

export interface SessionReport {
  summary: string;
  perQuestion: { questionId: string; observation: string; followUp: string | null }[];
  generatedAt: SessionTime;
}

export interface Session {
  candidateName: string;
  consentAt: number;
  startedAt: number;
  endedAt: number | null;
  source: "webcam" | "window" | "video";
  /** True when the Source had an audio track for speech-activity context (FR-005A). */
  speechAvailable: boolean;
  /** Local LLM model in use when the Session started, or null if none was available. */
  llmModel: string | null;
  baseline: Baseline | null;
  questions: Question[];
  flags: Flag[];
  moments: Moment[];
  followUp: FollowUpState;
  timeline: TimelineEvent[];
  report: SessionReport | null;
}
