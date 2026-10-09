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
} as const;
