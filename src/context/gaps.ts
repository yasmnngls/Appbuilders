/**
 * Deterministic, explainable gap analyzer for one Candidate answer.
 * It decides WHETHER a follow-up is worth suggesting and WHICH area it should target; the model only words it.
 * Conservative: a gap is reported only on clear textual evidence. Visual Flags never reach this module.
 */
import { findBanned, OBSERVATION_WORDS } from "../llm/guard";

export type GapId = "personal" | "steps" | "outcome";

export interface Gap {
  id: GapId;
  /** Short name shown to the Interviewer, e.g. "personal contribution". */
  label: string;
  /** One plain sentence citing the evidence in the answer. */
  reason: string;
}

export interface AnswerAnalysis {
  /** True when the answer is long enough to judge and no gap was found. */
  complete: boolean;
  /** Fewer than MIN_ANSWER_WORDS words: not enough context, so no follow-up (not a gap). */
  tooBrief: boolean;
  words: number;
  /** In priority order: personal, steps, outcome. */
  gaps: Gap[];
  /** Human labels of what the answer does cover. */
  covered: string[];
}

export const MIN_ANSWER_WORDS = 8;

export const GAP_LABELS: Record<GapId, string> = {
  personal: "personal contribution",
  steps: "specific steps",
  outcome: "outcome",
};

const TEAM_RE = /(?<![\p{L}])(we|we're|we've|we'd|our|us|team)(?![\p{L}])/giu;
/** Verbs after "I" that are not a concrete personal action (state, opinion, or vague). */
const NOT_ACTION = new Set(
  ("was were am be been think thought guess mean meant believe feel felt know knew had have has would could can will should " +
    "worked work helped help joined join did do was part guess suppose remember like liked love loved wanted want tried try " +
    "solved fixed handled dealt finished resolved sorted completed took got").split(" "),
);
/** Adverbs skipped between "I" and the verb ("I then added", "I personally wrote"). */
const ADVERBS = new Set("then also just really personally actually eventually basically first finally quickly mostly mainly".split(" "));
const ROLE_RE = /(?<![\p{L}])my\s+(?:part|role|job|task|responsibility|contribution)(?![\p{L}])/iu;

const VAGUE: [re: RegExp, base: string][] = [
  [/(?<![\p{L}])solved(?![\p{L}])/iu, "solve"],
  [/(?<![\p{L}])fixed(?![\p{L}])/iu, "fix"],
  [/(?<![\p{L}])handled(?![\p{L}])/iu, "handle"],
  [/(?<![\p{L}])dealt\s+with(?![\p{L}])/iu, "deal with"],
  [/(?<![\p{L}])worked\s+on(?![\p{L}])/iu, "work on"],
  [/(?<![\p{L}])finished(?![\p{L}])/iu, "finish"],
  [/(?<![\p{L}])resolved(?![\p{L}])/iu, "resolve"],
  [/(?<![\p{L}])sorted\s+(?:it\s+)?out(?![\p{L}])/iu, "sort out"],
  [/(?<![\p{L}])took\s+care\s+of(?![\p{L}])/iu, "take care of"],
  [/(?<![\p{L}])got\s+it\s+done(?![\p{L}])/iu, "get it done"],
];

/** How-detail: sequence/method words, or a concrete tool or technique. */
const HOW_RE = new RegExp(
  "(?<![\\p{L}])(?:by|first|firstly|then|so\\s+I|using|used|step|steps|after\\s+I|which\\s+I|" +
    "database|index|indexes|cache|caching|query|queries|api|apis|refactor\\w*|test|tests|testing|profil\\w*|logs?|logging|debug\\w*|" +
    "monitor\\w*|deploy\\w*|script|scripts|migration|migrat\\w*|schema|endpoint|server|servers|framework|library|sql|python|java|react|" +
    "docker|kubernetes|aws|git|prototype|retr(?:y|ies)|queue|queues|rollback|benchmark\\w*|metrics|dashboard|spreadsheet|survey|" +
    "workshop|checklist|pair(?:ed|ing)?|split|rewrote|rewrite|redesign\\w*|automat\\w*)(?![\\p{L}])",
  "iu",
);

const SITUATION_RE =
  /(?<![\p{L}])(problem|problems|difficult|hard|challenge|challenging|issue|issues|bug|bugs|deadline|outage|project|conflict|failing|failed|broke|broken|slow|tricky|complex|delay|delayed|crisis)(?![\p{L}])/iu;
const RESULT_RE =
  /(?<![\p{L}])(?:result|results|resulted|as\s+a\s+result|so(?!\s+(?:I|we)(?![\p{L}]))|ended\s+up|which\s+meant|improved|improve|reduced|increased|decreased|dropped|after\s+that|launched|shipped|saved|cut|faster|on\s+time|delivered|released|went\s+live|success|successful|successfully|outcome|learned|afterwards|afterward)(?![\p{L}])|%|\d/iu;

const words = (text: string) => text.match(/[\p{L}\p{N}%']+/gu) ?? [];

/** True when the answer has an "I <concrete verb>" or "my part/role was" statement. */
function hasConcreteFirstPerson(text: string): boolean {
  if (ROLE_RE.test(text)) return true;
  const toks = words(text);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] !== "I" && toks[i] !== "I've" && toks[i] !== "I'd") continue;
    let j = i + 1;
    while (j < toks.length && ADVERBS.has(toks[j].toLowerCase())) j++;
    const verb = toks[j]?.toLowerCase();
    if (verb && verb.length > 2 && !NOT_ACTION.has(verb) && /^[a-z]+$/.test(verb)) return true;
  }
  return false;
}

function teamCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(TEAM_RE)) {
    const w = m[1].toLowerCase().replace(/'.*$/, "");
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

/**
 * The first vague action phrase in the answer, as written, plus its base form.
 * "worked on" is used only when nothing else is vague (it usually just introduces the topic).
 */
export function vagueAction(text: string): { phrase: string; base: string; index: number } | null {
  let best: { phrase: string; base: string; index: number } | null = null;
  let workedOn: { phrase: string; base: string; index: number } | null = null;
  for (const [re, base] of VAGUE) {
    const m = re.exec(text);
    if (!m) continue;
    const hit = { phrase: m[0], base, index: m.index };
    if (base === "work on") workedOn = hit;
    else if (!best || m.index < best.index) best = hit;
  }
  return best ?? workedOn;
}

export function analyzeAnswer(answer: string): AnswerAnalysis {
  const text = answer.replace(/\s+/g, " ").trim();
  const n = words(text).length;
  if (n < MIN_ANSWER_WORDS) return { complete: false, tooBrief: true, words: n, gaps: [], covered: [] };

  const team = teamCounts(text);
  const teamTotal = [...team.values()].reduce((a, b) => a + b, 0);
  const firstPerson = hasConcreteFirstPerson(text);
  const vague = vagueAction(text);
  const how = HOW_RE.test(text);
  const situation = SITUATION_RE.exec(text)?.[0] ?? null;
  const hasAction = firstPerson || !!vague || teamTotal > 0 || /(?<![\p{L}])(?:I|we)\s+\w+ed(?![\p{L}])/iu.test(text);
  const result = RESULT_RE.test(text);

  const gaps: Gap[] = [];
  if (teamTotal > 0 && !firstPerson) {
    const cites = [...team].map(([w, c]) => `"${w}" ×${c}`).join(", ");
    gaps.push({
      id: "personal",
      label: GAP_LABELS.personal,
      reason: `The answer describes the team's work (${cites}) but not what the Candidate personally did.`,
    });
  }
  if (vague && !how) {
    gaps.push({
      id: "steps",
      label: GAP_LABELS.steps,
      reason: `The answer says "${vague.phrase}" but not how it was done.`,
    });
  }
  if (situation && hasAction && !result) {
    gaps.push({
      id: "outcome",
      label: GAP_LABELS.outcome,
      reason: `The answer describes the situation ("${situation}") and what was done, but not what happened as a result.`,
    });
  }

  const covered: string[] = [];
  if (situation) covered.push("the situation");
  if (firstPerson) covered.push("personal actions");
  if (how) covered.push("specific steps");
  if (result) covered.push("the result");
  return { complete: gaps.length === 0, tooBrief: false, words: n, gaps, covered };
}

/** Words never used as a follow-up topic: people, fillers and generic nouns. */
const NOT_TOPIC = new Set(
  ("team teams people person manager company role work time way thing things part end lot bit kind sort couple " +
    "problem problems issue issues situation result results job day days week weeks month months year years one it this that " +
    "first last same other new big small good bad very really more most some any each every few many whole " +
    "candidate interviewer").split(" "),
);
const STOP_AFTER = new Set(("was were is are and but or so because when while with to of in on at for from by that which who as " +
  "had has have it we i they then also").split(" "));

const safeTopic = (t: string) =>
  !!t && t.length >= 3 && !NOT_TOPIC.has(t) && findBanned(t).length === 0 &&
  !OBSERVATION_WORDS.some((w) => new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, "iu").test(t));

/** A short topic noun phrase from the answer ("backend", "reporting dashboard"), or null when none is safe. */
export function topicOf(answer: string): string | null {
  const text = answer.replace(/\s+/g, " ");
  const difficulty =
    /(?<![\p{L}])(?:the|our|my)\s+([\p{Ll}-]{3,}(?:\s+[\p{Ll}-]{3,})?)\s+(?:was|were|is|kept|became|got|had)\s+(?:\w+\s+)?(?:difficult|hard|tricky|challenging|slow|broken|failing|complex|messy|down|unstable)(?![\p{L}])/iu.exec(text);
  const candidates: string[] = [];
  if (difficulty) candidates.push(difficulty[1]);
  const problemWith = /(?<![\p{L}])(?:problem|problems|issue|issues|bug|bugs)\s+(?:with|in)\s+(?:the|our|my)\s+([\p{Ll}-]{3,}(?:\s+[\p{Ll}-]{3,})?)/iu.exec(text);
  if (problemWith) candidates.push(problemWith[1]);
  for (const m of text.matchAll(/(?<![\p{L}])(?:the|our|my|a|an)\s+([\p{Ll}-]{3,}(?:\s+[\p{Ll}-]{3,})?)/giu)) candidates.push(m[1]);
  for (const c of candidates) {
    const parts = c.toLowerCase().split(" ");
    // "the backend failed" / "our team rebuilt": a second word that is a past-tense verb is not part of the topic.
    if (parts.length === 2 && /ed$/.test(parts[1])) parts.pop();
    // Drop a trailing word that is really the next clause ("backend was").
    while (parts.length > 1 && STOP_AFTER.has(parts[parts.length - 1])) parts.pop();
    const phrase = parts.join(" ");
    const head = parts[parts.length - 1];
    if (parts.every((p) => !STOP_AFTER.has(p) && !NOT_TOPIC.has(p)) && safeTopic(head) && safeTopic(phrase)) return phrase;
  }
  return null;
}

/** Object of the vague action when it is concrete ("the problem", "the migration"), else null. */
function vagueObject(answer: string): string | null {
  const v = vagueAction(answer);
  if (!v) return null;
  const rest = answer.slice(v.index + v.phrase.length);
  const m = /^\s+(the|a|an|our|my)\s+([\p{Ll}-]{3,})/iu.exec(rest);
  if (!m) return null;
  const noun = m[2].toLowerCase();
  if (!safeTopic(noun) && !/^(problem|problems|issue|issues)$/.test(noun)) return null;
  return /^an?$/i.test(m[1]) ? "that" : `the ${noun}`;
}

/** Deterministic follow-up for a gap, filled with the answer's own topic when safe. Pre-checked by the language test. */
export function gapTemplate(gap: GapId, answer: string): string {
  const topic = topicOf(answer);
  switch (gap) {
    case "personal":
      return topic ? `What did you personally do on the ${topic}?` : "What did you personally do in that situation?";
    case "steps": {
      const v = vagueAction(answer);
      const verb = v?.base === "get it done" ? "get it done" : v?.base;
      if (!verb) return "What specific steps did you take to solve that?";
      if (verb === "get it done") return "What specific steps did you take to get it done?";
      const obj = vagueObject(answer) ?? (topic ? `the ${topic}` : "that");
      return `What specific steps did you take to ${verb} ${obj}?`;
    }
    case "outcome":
      return "What happened as a result?";
  }
}

/** Maps a free-text gap name (from the model) to an analyzer gap id, or null. */
export function gapIdOf(text: string | null | undefined): GapId | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/personal|contribution|individual|own role|your role|yourself|candidate did/.test(t)) return "personal";
  if (/step|how|specific|method|approach|process|detail/.test(t)) return "steps";
  if (/result|outcome|impact|effect|happened|afterward/.test(t)) return "outcome";
  return null;
}
