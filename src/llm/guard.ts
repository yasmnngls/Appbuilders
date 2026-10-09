/** PRD §18.1 + §28 list. Matched as whole words, case-insensitive, with simple stems. */
export const BANNED = ["cheat", "cheating", "lie", "lying", "lied", "liar", "suspicious", "suspicion",
  "uncomfortable", "discomfort", "dishonest", "dishonesty", "deception", "deceptive", "deceive",
  "violation", "risk", "integrity", "nervous", "anxious",
  // State-of-mind words: the report describes what was observed, never attention or feelings (PRD §18.6).
  "engaged", "disengaged", "engagement", "attention", "inattention", "attentive", "inattentive",
  "distracted", "focused", "unfocused", "confident", "unconfident",
  // Variants a stem match misses, and other judgements of honesty or feelings.
  "cheated", "cheater", "nervously", "nervousness", "anxiety", "anxiously", "suspiciously", "uncomfortably",
  "honest", "honestly", "honesty", "truthful", "truthfully", "untruthful", "stressed", "worried", "afraid",
  "scared", "uneasy", "evasive", "guilty", "hiding"] as const;

/**
 * State-of-mind and reason phrasings (PRD §18.6): "you seem…", "you look…", "you were reading", "were you looking at…",
 * "looked away because…". Each is reported by its label.
 */
const STATE_OF_MIND: [label: string, re: RegExp][] = [
  ["seem", /(?<![\p{L}])seem(?:s|ed|ing|ingly)?(?![\p{L}])/iu],
  ["appears to", /(?<![\p{L}])appear(?:s|ed)?\s+(?:to|as\s+if|like)(?![\p{L}])/iu],
  ["you look", /(?<![\p{L}])(?:you|they|he|she|candidate)\s+(?:look|looks|looked|sound|sounds|sounded)(?![\p{L}])/iu],
  ["you were reading", /(?<![\p{L}])(?:you|they|he|she|candidate)\s+(?:were|was|are|is)\s+(?:reading|looking|glancing|checking)(?![\p{L}])/iu],
  ["were you reading", /(?<![\p{L}])(?:were|are|was)\s+(?:you|they|he|she)\s+(?:reading|looking|glancing|checking)(?![\p{L}])/iu],
  ["because", /(?<![\p{L}])(?:away|down|aside|elsewhere|off[\s-]screen)(?![\p{L}])[^.?!]*(?<![\p{L}])because(?![\p{L}])|(?<![\p{L}])because\s+(?:you|they|he|she|the\s+candidate)(?![\p{L}])/iu],
];
/** Follow-ups must not point at the observation itself (FR-012). */
export const OBSERVATION_WORDS = ["look", "looking", "looked", "eye", "eyes", "gaze", "screen", "camera",
  "reading", "read", "notes", "someone", "anyone", "else in the room", "glance", "glancing", "stare", "staring", "webcam"] as const;

/** Phrases that make a follow-up ask for personal specifics or reasoning. */
const SPECIFIC_CUES = ["walk me through", "example", "specific", "step", "decide", "decision", "personally", "how did you", "what did you",
  "what happened", "result", "what was your", "how did that"];

const STOP_WORDS = new Set(
  ("about after again also been before being both could does doing done each from have having here into just like made make many more most much must only other over same should some such than that their them then there these they this those through very want were what when where which while will with would your you're yours tell me describe explain give talk question general interview labelled").split(" "),
);

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
/** Whole word, case-insensitive; allows a plural "s"/"es" ending (lies, risks) but not other words that contain it (relied, earlier). */
const wordRe = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?:e?s)?(?![\\p{L}\\p{N}])`, "iu");

function findWords(text: string, words: readonly string[]): string[] {
  return words.filter((w) => wordRe(w).test(text));
}

/** Banned words and state-of-mind phrasings found in text (lower-case list entries / labels), empty when clean. */
export function findBanned(text: string): string[] {
  return [...findWords(text, BANNED), ...STATE_OF_MIND.filter(([, re]) => re.test(text)).map(([label]) => label)];
}

/** Longest Interviewer Note / follow-up kept (characters). Longer model output is rejected; stored text is clipped. */
export const MAX_NOTE_CHARS = 240;
export const MAX_FOLLOW_UP_CHARS = 200;

/** Collapses whitespace (incl. newlines) and clips to max characters, ending with "…" when clipped. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const contentWords = (text: string) =>
  new Set((text.toLowerCase().match(/[\p{L}]+/gu) ?? []).filter((w) => w.length >= 4 && !STOP_WORDS.has(w)));

/** Loose stem so "projects"/"project", "scoped"/"scope" still count as shared. */
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "").slice(0, 6);

/** True when the label is a general placeholder rather than a real Question topic. */
export function isGeneralQuestion(label: string): boolean {
  return /^\(not labelled/.test(label) || /^question\s*\d+$/i.test(label.trim()) || /^introduction$/i.test(label.trim());
}

/**
 * Removes a "(the … question)"-style aside from a note when it names a topic the Question label does not share
 * (small models copy the prompt's "(the project question)" example onto unrelated or unlabelled questions).
 */
export function stripUngroundedTopic(note: string, question: string): string {
  const labelStems = new Set(isGeneralQuestion(question) ? [] : [...contentWords(question.toLowerCase())].map(stem));
  return note
    .replace(/\s*\((?:the|a|an)\s+([^()]*)\)/giu, (aside, inner: string) =>
      [...contentWords(inner)].some((w) => labelStems.has(stem(w))) ? aside : "",
    )
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Content-word stems of a text (4+ letters, stop words removed). */
export const contentStems = (text: string) => new Set([...contentWords(text)].map(stem));

/** Jaccard similarity of two texts' content-word stems, 0..1. */
export function similarity(a: string, b: string): number {
  const x = contentStems(a);
  const y = contentStems(b);
  if (!x.size && !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / (x.size + y.size - inter);
}

/** A follow-up this similar (Jaccard of content stems) to an already-asked one is a repeat. */
export const REPEAT_SIMILARITY = 0.6;
export const MIN_FOLLOW_UP_WORDS = 4;
export const MAX_FOLLOW_UP_WORDS = 25;

export interface FollowUpCheck {
  specific: boolean;
  neutral: boolean;
  /** Shares a content word with the Question or the Candidate's answer. */
  grounded: boolean;
  /** Too similar to a follow-up already asked in this Question. */
  repeat: boolean;
  problems: string[];
}

/**
 * Local, authoritative check of a follow-up (FR-013). The model's own judgement is never trusted.
 * Pass rule for model text: `passesFollowUp`.
 */
export function checkFollowUp(text: unknown, ctx: { question: string; answer: string; previous: string[] }): FollowUpCheck {
  const followUp = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  const problems: string[] = [];
  const banned = findBanned(followUp);
  const observed = findWords(followUp, OBSERVATION_WORDS);
  if (!followUp) problems.push("the follow-up was empty");
  if (banned.length) problems.push(`it used the words: ${banned.join(", ")}`);
  if (observed.length) problems.push(`the follow-up mentions the observation (${observed.join(", ")}); ask about the work instead`);
  const neutral = banned.length === 0 && observed.length === 0;

  const words = followUp.split(/\s+/).filter(Boolean).length;
  if (followUp && !followUp.endsWith("?")) problems.push("the follow-up must be one question ending with ?");
  if (followUp && words < MIN_FOLLOW_UP_WORDS) problems.push(`the follow-up is shorter than ${MIN_FOLLOW_UP_WORDS} words`);
  if (words > MAX_FOLLOW_UP_WORDS) problems.push(`the follow-up is longer than ${MAX_FOLLOW_UP_WORDS} words`);
  if (followUp.length > MAX_FOLLOW_UP_CHARS) problems.push(`the follow-up is longer than ${MAX_FOLLOW_UP_CHARS} characters`);
  if (/\?.+\?/.test(followUp)) problems.push("ask only ONE question");
  const lower = followUp.toLowerCase();
  const specific = followUp.endsWith("?") && words >= MIN_FOLLOW_UP_WORDS && words <= MAX_FOLLOW_UP_WORDS && SPECIFIC_CUES.some((c) => lower.includes(c));

  const source = contentStems(`${isGeneralQuestion(ctx.question) ? "" : ctx.question} ${ctx.answer}`);
  const grounded = [...contentStems(followUp)].some((w) => source.has(w));
  if (followUp && !grounded) problems.push("the follow-up must reuse a word or topic from the candidate's answer");

  const repeat = ctx.previous.some((p) => similarity(p, followUp) >= REPEAT_SIMILARITY);
  if (repeat) problems.push("the follow-up repeats a previous follow-up; target a different unclear area");
  return { specific, neutral, grounded, repeat, problems };
}

/** True when model-written follow-up text may be shown: neutral, one short question, grounded, not a repeat. */
export function passesFollowUp(text: unknown, c: FollowUpCheck): boolean {
  const t = typeof text === "string" ? text.trim() : "";
  const words = t.split(/\s+/).filter(Boolean).length;
  return (
    !!t && c.neutral && c.grounded && !c.repeat && t.endsWith("?") && !/\?.+\?/.test(t) &&
    words >= MIN_FOLLOW_UP_WORDS && words <= MAX_FOLLOW_UP_WORDS && t.length <= MAX_FOLLOW_UP_CHARS
  );
}

/** Interviewer Note check: present, within the cap, no banned word. */
export function checkNote(text: unknown): { ok: boolean; problems: string[] } {
  const note = typeof text === "string" ? text.trim() : "";
  const problems: string[] = [];
  if (!note) problems.push("the interviewer note was empty");
  if (note.length > MAX_NOTE_CHARS) problems.push(`the interviewer note is longer than ${MAX_NOTE_CHARS} characters`);
  const banned = findBanned(note);
  if (banned.length) problems.push(`the note used the words: ${banned.join(", ")}`);
  return { ok: problems.length === 0, problems };
}
