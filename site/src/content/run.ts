/** The label for the replay demo. It never says "live" without the qualifier. */
export const REPLAY_CHIP = "Live demo (replayed model calls)";

/** The banner above the replay. */
export const REPLAY_BANNER =
  "Model calls are replayed from recorded cassettes; the orchestrator, verifiers and state machine run live on this request.";

/** The label beside the committed E2 result. */
export const E2_OFFLINE_LABEL =
  "Measured offline with Playwright; not run on this server.";

/** How the replay is paced. */
export const PACE_NOTE =
  "Recorded pace replays each gap between model events as it was recorded, capped at {gapSeconds} s, so a run takes about as long as the original; fast-forward divides every gap by {factor}. The events and the game are the same at either speed. This item's recorded run took {recordedSeconds}.";

/** The speed choices, fast-forward first because it is the default. */
export const PACE_OPTIONS = [
  { value: "fast", label: "Fast-forward" },
  { value: "recorded", label: "Recorded pace" },
] as const;

/** Shown when the prompt list could not be fetched and the bundled copy is used instead. */
export const FALLBACK_NOTE =
  "The prompt list could not be loaded from the server, so the page is using the copy bundled at build time.";

/** Status line text for each phase of the replay connection. */
export const PHASE_TEXT = {
  idle: "Pick a prompt and start the replay.",
  connecting: "Connecting to /api/replay…",
  streaming: "Streaming events from the server.",
  reconnecting: "Connection dropped; reconnecting from the last event.",
  complete: "Run complete.",
  abandoned: "The run ended without a game.",
  stopped: "Stopped.",
  error: "The replay could not run.",
} as const;
