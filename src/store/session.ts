import { useRef, useSyncExternalStore } from "react";
import type { FlagTransition } from "../rules/engine";
import type { FollowUpEffect } from "../rules/followUp";
import {
  FLAG_LABELS,
  type Flag,
  type FlagEvidence,
  type FollowUpState,
  type Moment,
  type Question,
  type Session,
  type SessionReport,
  type SessionTime,
  type Signal,
  type SpeechState,
  type TimelineEvent,
} from "../domain/types";

export type Screen = "consent" | "source" | "baseline" | "live" | "report";

/** Live, non-persisted app state. Vision code writes; React reads via useStore (throttled). Nothing goes to localStorage. */
export interface LiveState {
  session: Session | null;
  latestSignal: Signal | null;
  fps: number;
  baselineProgress: number;
  llm: "unknown" | "ready" | "busy" | "unavailable";
  vision: { status: "loading" } | { status: "ready"; delegate: "GPU" | "CPU" } | { status: "error"; message: string };
  reportStatus: "idle" | "generating" | "done" | "fallback";
  online: boolean;
  /** Set on Screen 1 Continue, before a Session exists. */
  draft: { candidateName: string; consentAt: number } | null;
  /** Screen 2 preview: a Source is open and showing. */
  sourceReady: { kind: Session["source"]; hasAudio: boolean } | null;
  speech: SpeechState;
  llmModel: string | null;
  llmLatencyMs: number | null;
  lightweight: boolean;
  /** Drives the short "Baseline ready" confirmation. */
  baselineJustCompleted: boolean;
  /** Flag Details overlay. */
  openFlagId: string | null;
}

const initialState = (): LiveState => ({
  session: null,
  latestSignal: null,
  fps: 0,
  baselineProgress: 0,
  llm: "unknown",
  vision: { status: "loading" },
  reportStatus: "idle",
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  draft: null,
  sourceReady: null,
  speech: "unavailable",
  llmModel: null,
  llmLatencyMs: null,
  lightweight: false,
  baselineJustCompleted: false,
  openFlagId: null,
});

let state: LiveState = initialState();

const listeners = new Set<() => void>();
let scheduled = false;

/** Notify subscribers at most ~10x per second so 30fps vision updates never thrash React. */
function emit() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    listeners.forEach((l) => l());
  }, 100);
}

export const store = {
  get: () => state,
  set(patch: Partial<LiveState>) {
    state = { ...state, ...patch };
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const shallowEqual = (a: unknown, b: unknown) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is((a as never)[k], (b as never)[k]));
};

/** Subscribe to a slice of state. Derived arrays/objects are fine: results are compared shallowly. */
export function useStore<T>(select: (s: LiveState) => T): T {
  const last = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const next = select(state);
    if (last.current && shallowEqual(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  });
}

/** The screen is derived, never stored, so it can't drift from the data. */
export function selectScreen(s: LiveState): Screen {
  if (!s.session) return s.draft ? "source" : "consent";
  if (s.session.endedAt !== null) return "report";
  if (!s.session.baseline) return "baseline";
  return "live";
}

export const uid = () => Math.random().toString(36).slice(2, 10);

function updateSession(fn: (s: Session) => Session) {
  if (state.session) store.set({ session: fn(state.session) });
}

/** Milliseconds since the Session started (frozen at the end once the Session has ended). */
export const sessionNow = (): SessionTime => {
  const s = state.session;
  if (!s) return 0;
  return Math.max(0, (s.endedAt ?? Date.now()) - s.startedAt);
};

export const currentQuestion = (s: Session): Question => s.questions[s.questions.length - 1];

const questionLabel = (q: Question) => `Q${q.number} ${q.label}`;

/** Longest Candidate name / Question label kept. Labels go into the local LLM prompt and the report. */
export const MAX_NAME_LENGTH = 100;
export const MAX_LABEL_LENGTH = 200;

// ---------------------------------------------------------------------------
// Screen 1 / 2

/** Screen 1 Continue: consent recorded (FR-001). */
export function confirmConsent(candidateName: string) {
  store.set({ draft: { candidateName: candidateName.trim().slice(0, MAX_NAME_LENGTH), consentAt: Date.now() } });
}

export function setSourceReady(sourceReady: LiveState["sourceReady"]) {
  store.set({ sourceReady });
}

// ---------------------------------------------------------------------------
// Session lifecycle

/** FR-001: a Session only starts from a confirmed Consent (the draft). Returns false, and starts nothing, without one. */
export function startSession(input: { source: Session["source"]; speechAvailable: boolean; llmModel: string | null }): boolean {
  const draft = state.draft;
  if (!draft) return false;
  const q1: Question = { id: uid(), number: 1, label: "Introduction", start: 0 };
  // Same shape as rules/followUp initialFollowUp(q1.id, 0).
  const followUp: FollowUpState = { questionId: q1.id, phase: "observing", used: 0, reObserveUntil: null, momentId: null, watchFrom: 0, askedMomentId: null };
  store.set({
    draft: null,
    openFlagId: null,
    baselineJustCompleted: false,
    reportStatus: "idle",
    session: {
      candidateName: draft.candidateName,
      consentAt: draft.consentAt,
      startedAt: Date.now(),
      endedAt: null,
      source: input.source,
      speechAvailable: input.speechAvailable,
      llmModel: input.llmModel,
      baseline: null,
      questions: [q1],
      flags: [],
      moments: [],
      followUp,
      timeline: [{ t: 0, kind: "question", questionId: q1.id, text: `Question started — ${questionLabel(q1)}` }],
      report: null,
    },
  });
  return true;
}

/** Adds a Question. The controller then sends `question_started` through the follow-up reducer. */
export function nextQuestion(label?: string): Question | null {
  const s = state.session;
  if (!s || s.endedAt !== null) return null;
  const number = s.questions.length + 1;
  const q: Question = { id: uid(), number, label: label?.trim().slice(0, MAX_LABEL_LENGTH) || `Question ${number}`, start: sessionNow() };
  updateSession((x) => ({ ...x, questions: [...x.questions, q] }));
  store.set({ openFlagId: null });
  return q;
}

type Transition = FlagTransition & { evidence?: FlagEvidence };

export function applyTransitions(transitions: Transition[]) {
  if (!transitions.length) return;
  updateSession((s) => {
    let flags = s.flags;
    let timeline = s.timeline;
    for (const tr of transitions) {
      if (tr.state === "start") {
        // FR-007: a Flag belongs to the Question active at its start.
        const q = [...s.questions].reverse().find((q) => q.start <= tr.t) ?? currentQuestion(s);
        const flag: Flag = { id: uid(), kind: tr.kind, start: tr.t, end: null, questionId: q.id, detail: tr.detail };
        if (tr.evidence) flag.evidence = { ...tr.evidence };
        flags = [...flags, flag];
        timeline = [...timeline, { t: tr.t, kind: "flag", questionId: q.id, text: `Flag — ${FLAG_LABELS[tr.kind]} (Q${q.number})` }];
      } else {
        let closed = false;
        flags = flags.map((f) => {
          if (closed || f.kind !== tr.kind || f.end !== null) return f;
          closed = true;
          return { ...f, end: tr.t, ...(tr.evidence ? { evidence: { ...f.evidence, ...tr.evidence } } : {}) };
        });
      }
    }
    return { ...s, flags, timeline };
  });
}

export function setBaseline(baseline: Session["baseline"]) {
  updateSession((s) => ({ ...s, baseline }));
}

/** Sets the follow-up state and applies decision, result and timeline effects. `open_moment` is handled by the controller. */
export function applyFollowUp(followUp: FollowUpState, effects: FollowUpEffect[]) {
  updateSession((s) => {
    let moments = s.moments;
    let timeline = s.timeline;
    const patch = (id: string, p: Partial<Moment>) => {
      moments = moments.map((m) => (m.id === id ? { ...m, ...p } : m));
    };
    for (const e of effects) {
      if (e.type === "moment_decision") patch(e.momentId, e.decision === "asked" ? { decision: e.decision, askedAt: e.t } : { decision: e.decision });
      else if (e.type === "moment_result") patch(e.momentId, { result: e.result });
      else if (e.type === "timeline") timeline = [...timeline, { t: e.t, kind: e.kind, questionId: followUp.questionId, text: e.text }];
    }
    return { ...s, followUp, moments, timeline };
  });
}

export function openMoment(m: Moment) {
  updateSession((s) => ({ ...s, moments: [...s.moments, m] }));
}

export function updateMoment(id: string, p: Partial<Moment>) {
  updateSession((s) => ({ ...s, moments: s.moments.map((m) => (m.id === id ? { ...m, ...p } : m)) }));
}

export function dismissFlag(id: string) {
  updateSession((s) => ({ ...s, flags: s.flags.map((f) => (f.id === id ? { ...f, dismissed: true } : f)) }));
}

export function setOpenFlag(id: string | null) {
  store.set({ openFlagId: id });
}

export function setSpeech(speech: SpeechState) {
  if (state.speech !== speech) store.set({ speech });
}

export function setLlm(p: { model?: string | null; latencyMs?: number | null; lightweight?: boolean; status?: LiveState["llm"] }) {
  const patch: Partial<LiveState> = {};
  if (p.model !== undefined) patch.llmModel = p.model;
  if (p.latencyMs !== undefined) patch.llmLatencyMs = p.latencyMs;
  if (p.lightweight !== undefined) patch.lightweight = p.lightweight;
  if (p.status !== undefined) patch.llm = p.status;
  store.set(patch);
}

/** Closes open Flags and appends `session-end`. A Moment being re-observed keeps `result: null`. */
export function endSession() {
  const s0 = state.session;
  if (!s0 || s0.endedAt !== null) return;
  const t = sessionNow();
  const endedAt = Date.now();
  const q = currentQuestion(s0);
  const text = s0.followUp.phase === "re_observing" ? "Session ended during re-observation" : "Session ended";
  const end: TimelineEvent = { t, kind: "session-end", questionId: q.id, text };
  updateSession((s) => ({
    ...s,
    endedAt,
    flags: s.flags.map((f) => (f.end === null ? { ...f, end: t } : f)),
    timeline: [...s.timeline, end],
  }));
  store.set({ openFlagId: null });
}

export function setReport(report: SessionReport) {
  updateSession((s) => ({ ...s, report }));
}

/** Back to Screen 1. Environment status (vision, local model, online) is kept; everything about the Session is reset. */
export function clearSession() {
  const init = initialState();
  store.set({
    ...init,
    vision: state.vision,
    llm: state.llm === "busy" ? "ready" : state.llm,
    llmModel: state.llmModel,
    llmLatencyMs: state.llmLatencyMs,
    lightweight: state.lightweight,
    online: state.online,
  });
}
