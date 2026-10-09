/**
 * §13.3 language test and §13.4 privacy checks.
 * Banned words (PRD §18.1) must not appear in any user-facing string, prompt, fallback text or export.
 */
import { describe, expect, it } from "vitest";
import { FLAG_LABELS, type FlagKind, type Moment, type Session } from "./domain/types";
import { CONTRACT_SYSTEM } from "./llm/contract";
import { findBanned } from "./llm/guard";
import { fallbackSuggestion } from "./llm/moments";
import { fallbackReport, toJSON, toMarkdown } from "./llm/report";

const SOURCES = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./llm/guard.ts", "!./**/testing/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** String literals, template literal text and JSX text of one source file (comments skipped). */
export function extractText(src: string, jsx: boolean): string[] {
  const out: string[] = [];
  const code: string[] = [];
  let i = 0;
  let codeStart = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      code.push(src.slice(codeStart, i));
      i = src.indexOf("\n", i);
      if (i < 0) i = src.length;
      codeStart = i;
    } else if (c === "/" && n === "*") {
      code.push(src.slice(codeStart, i));
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      codeStart = i;
    } else if (c === '"' || c === "'" || c === "`") {
      code.push(src.slice(codeStart, i));
      let j = i + 1;
      let buf = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (c !== "`" && src[j] === "\n") break; // unterminated: probably JSX text with an apostrophe
        buf += src[j];
        j++;
      }
      if (c !== "`" && src[j] !== c) {
        // Not a real string (e.g. "don't" inside JSX text): treat the quote as code.
        i++;
        codeStart = i - 1;
        continue;
      }
      out.push(buf);
      i = j + 1;
      codeStart = i;
    } else i++;
  }
  code.push(src.slice(codeStart));
  if (jsx) for (const m of code.join(" ").matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  return out;
}

describe("language (PRD §18.1)", () => {
  it("finds source files", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(5);
    expect(Object.keys(SOURCES)).not.toContain("./llm/guard.ts");
  });

  it("extracts strings, template text and JSX text, not comments", () => {
    const got = extractText(`// cheating\nconst a = "one"; /* lying */ const b = \`two \${x}\`;\nconst c = <p>three</p>;`, true);
    expect(got).toEqual(expect.arrayContaining(["one", "two ${x}", "three"]));
    expect(got.join(" ")).not.toMatch(/cheating|lying/);
  });

  it("no source file uses a banned word in a string or JSX text", () => {
    const hits: string[] = [];
    for (const [path, src] of Object.entries(SOURCES)) {
      for (const text of extractText(src, path.endsWith(".tsx"))) {
        const banned = findBanned(text);
        if (banned.length) hits.push(`${path}: ${banned.join(", ")} in "${text.trim().slice(0, 80)}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the prompt, fallback suggestions and fallback report are clean", () => {
    expect(findBanned(CONTRACT_SYSTEM)).toEqual([]);
    const s = sampleSession();
    for (const kind of Object.keys(FLAG_LABELS) as FlagKind[]) {
      for (const followUpNumber of [1, 2]) {
        const sug = fallbackSuggestion(s, sampleMoment(kind, followUpNumber));
        expect(findBanned(`${sug.note} ${sug.followUp}`)).toEqual([]);
        expect(sug.quality.neutral).toBe(true);
      }
    }
    const r = fallbackReport(s);
    expect(findBanned([r.summary, ...r.perQuestion.flatMap((p) => [p.observation, p.followUp ?? ""])].join("\n"))).toEqual([]);
    expect(findBanned(toMarkdown(s))).toEqual([]);
  });

  it("explainFlag (if present) is clean for every kind", async () => {
    const candidates = Object.entries(SOURCES).filter(([, src]) => /export (function|const) explainFlag\b/.test(src));
    const loaders = import.meta.glob(["./{rules,ui,vision,llm,app,store}/**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"]);
    const s = sampleSession();
    for (const [path] of candidates) {
      const mod = (await loaders[path]?.()) as { explainFlag?: (...a: unknown[]) => unknown } | undefined;
      if (!mod?.explainFlag) continue;
      for (const f of s.flags) {
        let out: unknown;
        try {
          out = mod.explainFlag(f, s.baseline, s);
        } catch {
          out = mod.explainFlag(f);
        }
        expect(findBanned(JSON.stringify(out ?? ""))).toEqual([]);
      }
    }
  });
});

describe("privacy (§13.4)", () => {
  it("JSON export contains no images", () => {
    expect(toJSON(sampleSession())).not.toMatch(/data:image|blob:/);
  });

  it("only llm/ollama.ts calls fetch", () => {
    const callers = Object.entries(SOURCES)
      .filter(([path, src]) => path !== "./llm/ollama.ts" && /(^|[^.\w])fetch\s*\(/.test(src.replace(/\/\/.*$/gm, "")))
      .map(([path]) => path);
    expect(callers).toEqual([]);
  });
});

function sampleMoment(kind: FlagKind, followUpNumber: number): Moment {
  const flagId = { "off-screen": "f1", "reading-pattern": "f2", "face-missing": "f3", "second-face": "f4" }[kind];
  return {
    id: `m-${kind}`, questionId: "q2", t: 110000, kind, origin: "gate", reason: "3 off-screen glances within 60s",
    flagIds: [flagId], followUpNumber, note: null, followUp: null, quality: null, suggestion: "generating",
    decision: "asked", askedAt: 111000, result: "settled",
  };
}

function sampleSession(): Session {
  const baseline = { centreX: 0, centreY: 0, spreadX: 3, spreadY: 2 };
  return {
    candidateName: "Sample", consentAt: 0, startedAt: 1000, endedAt: 301000, source: "webcam", speechAvailable: false, llmModel: null,
    baseline,
    questions: [
      { id: "q1", number: 1, label: "Introduction", start: 0 },
      { id: "q2", number: 2, label: "Tell me about a difficult project", start: 60000 },
    ],
    flags: [
      { id: "f1", kind: "off-screen", start: 70000, end: 75000, questionId: "q2", evidence: { baseline, thresholdDeg: { x: 10, y: 10 }, peakDeviationDeg: 14, direction: "left" } },
      { id: "f2", kind: "reading-pattern", start: 80000, end: 88000, questionId: "q2", evidence: { cycles: 5 } },
      { id: "f3", kind: "face-missing", start: 90000, end: 96000, questionId: "q2" },
      { id: "f4", kind: "second-face", start: 100000, end: 104000, questionId: "q2", evidence: { faceCount: 2 } },
    ],
    moments: (Object.keys(FLAG_LABELS) as FlagKind[]).map((k) => sampleMoment(k, 1)),
    followUp: { questionId: "q2", phase: "observing", used: 1, reObserveUntil: null, momentId: null, watchFrom: 0, askedMomentId: null },
    timeline: [{ t: 60000, kind: "question", questionId: "q2", text: "Q2 started" }],
    report: null,
  };
}
