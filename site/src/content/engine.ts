/**
 * Engine settings the page quotes. They are configuration, not results, and a test checks each
 * one against its `export const` in the engine source so the page cannot drift from the code.
 */
export const ENGINE_CONSTANTS = {
  MAX_REPAIRS: 3,
  MAX_CLAIMS: 2,
  MAX_CLAIMS_EVAL: 1,
  HEARTBEAT_INTERVAL_MS: 20_000,
  STALE_ACTIVE_MS: 75_000,
  SEAL_LEASE_MS: 30_000,
  RELAY_POLL_MS: 200,
  RELAY_HEARTBEAT_MS: 12_000,
  RELAY_BUDGET_MS: 270_000,
  REPLAY_MAX_GAP_MS: 1_500,
  FAST_FORWARD_FACTOR: 8,
  MAX_DURATION_SECONDS: 300,
} as const;

/** Where each constant is defined, relative to the repo root. */
export const ENGINE_CONSTANT_FILES: Readonly<
  Record<keyof typeof ENGINE_CONSTANTS, string>
> = {
  MAX_REPAIRS: "src/engine/budgets.ts",
  MAX_CLAIMS: "src/engine/lifecycle.ts",
  MAX_CLAIMS_EVAL: "src/engine/lifecycle.ts",
  HEARTBEAT_INTERVAL_MS: "src/engine/lifecycle.ts",
  STALE_ACTIVE_MS: "src/engine/lifecycle.ts",
  SEAL_LEASE_MS: "src/engine/lifecycle.ts",
  RELAY_POLL_MS: "src/engine/relay.ts",
  RELAY_HEARTBEAT_MS: "src/engine/relay.ts",
  RELAY_BUDGET_MS: "src/engine/relay.ts",
  REPLAY_MAX_GAP_MS: "src/models/cassette.ts",
  FAST_FORWARD_FACTOR: "src/models/cassette.ts",
  MAX_DURATION_SECONDS: "scripts/build-vercel.ts",
};

/** The knowledge cards the planner and builder read, by kind (counted from `src/cards/` by a test). */
export const CARD_KINDS = {
  contract: ["bridge", "game-page"],
  type: ["arcade-run", "puzzle-board", "stage-clear", "toy-box"],
  input: ["drag-follow", "swipe-lanes", "tap-anywhere"],
  style: ["chalkboard", "paper-cut", "risograph"],
} as const;

/** The builder's and planner's tools (SPEC §4.3); `verify` is kept away from the builder. */
export const AGENT_TOOLS = [
  "list_cards",
  "get_card",
  "load_draft",
  "save_draft",
] as const;

/** The run table's own status vocabulary (SPEC §5.1). */
export const RUN_STATUSES = [
  "waiting",
  "active",
  "sealing",
  "complete",
  "abandoned",
] as const;
