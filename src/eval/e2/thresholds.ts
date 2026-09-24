/**
 * E2 probe constants (§8.3). The threshold block is frozen after calibration on this repo's own
 * tuning fixtures; `docs/research/e2-calibration.md` lists the measured margin for each value.
 */

/** Probe viewport, matching the demo page's iframe (arbitrary starting size). */
export const PROBE_VIEWPORT = { width: 360, height: 640 } as const;
/** How long the probe waits for `boot` after loading the game (arbitrary cap). */
export const BOOT_TIMEOUT_MS = 4_000;
/** How long the probe waits for `start` after the centre tap (arbitrary cap). */
export const START_TIMEOUT_MS = 2_500;
/** Gap between the two frames of a motion pair (arbitrary starting value). */
export const FRAME_GAP_MS = 180;
/** A frame whose luma standard deviation is below this is blank. */
export const BLANK_LUMA_STDDEV_MIN = 3.5;
/** A frame with fewer distinct RGBA colours than this is blank. */
export const BLANK_DISTINCT_COLOURS_MIN = 6;
/** A pixel counts as moved when |ΔR|+|ΔG|+|ΔB| exceeds this. */
export const MOTION_CHANNEL_DELTA_MIN = 30;
/** Minimum share of moved pixels during the idle window for types that must animate. */
export const IDLE_MOTION_RATIO_MIN = 0.001;
/** Minimum share of moved pixels between the frames before and after a tap. */
export const TAP_MOTION_RATIO_MIN = 0.002;
/** An idle `arcade-run`/`stage-clear` player must survive at least this long after `start`. */
export const IDLE_DEATH_MIN_SECONDS = 4;
/** Length of the no-input window that follows `start`. */
export const IDLE_WINDOW_SECONDS = 6;
/** Random-tap bot trials per game (reported only). */
export const BOT_TRIALS = 3;
/** Cap on one random-tap bot trial (reported only). */
export const BOT_TRIAL_MAX_SECONDS = 25;

/** Delay from `start` to idle frame A, so the first drawn play frame is settled (arbitrary). */
export const IDLE_FRAME_DELAY_MS = 400;
/** Settle time after a host `reset` before the tap-pair frames (arbitrary). */
export const RESET_SETTLE_MS = 300;
/** Shortest and longest gap between two random bot taps (arbitrary). */
export const BOT_TAP_GAP_MIN_MS = 120;
export const BOT_TAP_GAP_MAX_MS = 700;
