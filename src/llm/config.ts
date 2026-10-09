/** Local LLM limits (PRD §14A.3, §14A.5). Docs quote these; code never hard-codes them elsewhere. */
export const LLM = {
  /** A single chat call is aborted after this long. */
  timeoutMs: 20_000,
  /** The Session Report is written once after the Session, so it may take longer. */
  reportTimeoutMs: 90_000,
  /** Whole budget for one Moment's suggestion (queue wait + call + retry); the deterministic fallback is shown after it. */
  suggestionBudgetMs: 20_000,
  /** Output cap for the Session Report call; a cut-off answer is invalid JSON and falls back. */
  reportMaxTokens: 1500,
  /** Output cap for one suggestion (note + follow-up), keeps latency down. */
  suggestionMaxTokens: 200,
  /** A call slower than this (or a timeout) switches to the next lighter installed model. */
  slowMs: 8_000,
  /** Extra attempts after a suggestion fails the local quality check. */
  maxRetries: 1,
  /** How long Ollama keeps the model loaded between calls. */
  keepAlive: "30m",
};
