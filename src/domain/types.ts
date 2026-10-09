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
}

export interface Question {
  id: string;
  /** 1-based number shown as Q1, Q2... */
  number: number;
  label: string;
  start: SessionTime;
}

export interface InterviewerNote {
  id: string;
  t: SessionTime;
  questionId: string | null;
  text: string;
  followUp?: string;
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
  source: "webcam" | "window";
  baseline: Baseline | null;
  questions: Question[];
  flags: Flag[];
  notes: InterviewerNote[];
  report: SessionReport | null;
}
