/** Every rule threshold lives here so tuning on the demo laptop is one file. Angles in degrees, times in ms. */
export const RULES = {
  baseline: {
    durationMs: 15_000,
    minSpread: 3,
  },
  offScreen: {
    spreadMultiplier: 2.5,
    minThreshold: 10,
    onMs: 1_500,
    offMs: 500,
  },
  reading: {
    /** Smoothing factor for gaze before segmenting (0..1, higher = less smoothing). */
    smoothing: 0.5,
    /** Reversal needed before a new run starts; filters jitter. */
    hysteresis: 1.5,
    /** A drift along a line must cover this many degrees... */
    driftMinAmp: 5,
    /** ...and take at least this long between 20% and 80% of its amplitude (rules out single glances). */
    driftMinMs: 500,
    /** A return's 20%-80% core must be this fast. */
    returnMaxMs: 350,
    /** A return must cover at least this fraction of the drift it follows. */
    returnMinFraction: 0.7,
    /** Drifts counted together must start within this many degrees of each other (the text's left margin). */
    marginTolerance: 2.5,
    /** minCycles back-to-back line sweeps must fit in this window. */
    windowMs: 10_000,
    /**
     * Back-to-back line sweeps needed to raise the Flag. 3 starts ~2s sooner but in synthetic
     * conversation gave ~1 false Flag per 3-4 hours; 4 gave none in 15 hours.
     */
    minCycles: 4,
    endAfterMs: 4_000,
  },
  faceMissing: { onMs: 2_000, offMs: 500 },
  secondFace: { onMs: 1_000, offMs: 500 },
  /** Evidence gate for a Moment worth exploring, and the follow-up loop (PRD §11). Precision over frequency. */
  followUp: {
    /** No Moment in the first seconds of a Question: thinking time. Time inside it doesn't count toward any Flag. */
    graceMs: 10_000,
    secondFaceMs: 3_000,
    faceMissingMs: 5_000,
    /** One off-screen Flag held this long opens a Moment... */
    offScreenSustainedMs: 6_000,
    /** ...stricter when there is no speech context (FR-005A visual-only fallback). */
    offScreenSustainedNoSpeechMs: 8_000,
    /** Or this many off-screen Flags inside repeatWindowMs. */
    repeatCount: 3,
    repeatCountNoSpeech: 4,
    repeatWindowMs: 60_000,
    /** Off-screen glances inside a pause this short that ends with speech resuming are treated as thinking. */
    thinkingPauseMaxMs: 4_000,
    /** How long to re-observe after a follow-up is asked before calling it settled. */
    reObserveMs: 30_000,
  },
} as const;

/** Vision sampling caps (PRD §14A.2, §14A.5). The pipeline skips frames closer together than 1000 / maxFps ms. */
export const VISION = {
  maxFps: 30,
  /**
   * Lightweight mode cap. 10 fps leaves only ~3 samples inside a reading return (returnMaxMs 350 ms);
   * synthetic reading still hit 8/8 at 10 and 15 fps (engine.test.ts "sampling rates"), but real tracking is
   * noisier, so the cap stays at 15 fps for margin.
   */
  lightweightMaxFps: 15,
} as const;
