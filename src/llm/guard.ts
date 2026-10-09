import type { ContractInput, ContractOutput } from "./contract";

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
  "reading", "read", "notes", "someone", "anyone", "else in the room"] as const;

/** Phrases that make a follow-up ask for personal specifics or reasoning. */
const SPECIFIC_CUES = ["walk me through", "example", "specific", "step", "decide", "decision", "you personally", "how did you", "what did you"];

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

/**
 * Local, authoritative quality check (FR-013). The model's own `quality` self-report is never trusted.
 * Pass rule for callers: `neutral` and a non-empty follow-up.
 */
export function checkQuality(
  out: ContractOutput,
  input: ContractInput,
): { specific: boolean; neutral: boolean; grounded: boolean; problems: string[] } {
  const note = typeof out.interviewer_note === "string" ? out.interviewer_note.trim() : "";
  const followUp = typeof out.follow_up === "string" ? out.follow_up.trim() : "";
  const problems: string[] = [];

  const banned = [...new Set([...findBanned(note), ...findBanned(followUp)])];
  const observed = findWords(followUp, OBSERVATION_WORDS);
  if (banned.length) problems.push(`it used the words: ${banned.join(", ")}`);
  if (observed.length) problems.push(`the follow-up mentions the observation (${observed.join(", ")}); ask about the topic instead`);
  if (!followUp) problems.push("the follow-up was empty");
  if (!note) problems.push("the interviewer note was empty");
  if (note.length > MAX_NOTE_CHARS) problems.push(`the interviewer note is longer than ${MAX_NOTE_CHARS} characters`);
  if (followUp.length > MAX_FOLLOW_UP_CHARS) problems.push(`the follow-up is longer than ${MAX_FOLLOW_UP_CHARS} characters`);
  const neutral = banned.length === 0 && observed.length === 0;

  const words = followUp.split(/\s+/).filter(Boolean).length;
  const lower = followUp.toLowerCase();
  const hasCue = SPECIFIC_CUES.some((c) => lower.includes(c));
  const specific = followUp.endsWith("?") && words >= 6 && words <= 25 && hasCue;
  if (!followUp.endsWith("?")) problems.push("the follow-up must be one question ending with ?");
  if (words > 25) problems.push("the follow-up is longer than 25 words");
  if (followUp && !hasCue) problems.push('the follow-up should ask for a specific example or "walk me through" the steps');

  let grounded = true;
  if (!isGeneralQuestion(input.question)) {
    const label = input.question.toLowerCase();
    const qNum = /\bQ(\d+)\b/i.exec(note)?.[1];
    const labelStems = new Set([...contentWords(label)].map(stem));
    const shares = (text: string) => [...contentWords(text)].some((w) => labelStems.has(stem(w)));
    const noteGrounded = qNum !== undefined || note.toLowerCase().includes(label) || shares(note);
    const followGrounded = shares(followUp);
    grounded = noteGrounded && followGrounded;
    if (!noteGrounded) problems.push("the note must name the question");
    if (!followGrounded) problems.push(`the follow-up must be about the question topic: "${input.question}"`);
  }
  return { specific, neutral, grounded, problems };
}
