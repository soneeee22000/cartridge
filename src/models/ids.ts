/** The roles a model plays: planner and builder generate, judge runs E3. */
export const MODEL_ROLES = ["planner", "builder", "judge"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** Model id per role (§7.1). */
export const MODEL_IDS: Readonly<Record<ModelRole, string>> = {
  planner: "claude-sonnet-5",
  builder: "claude-sonnet-5",
  judge: "claude-haiku-4-5",
};

/** Sent in replay and mock modes, where the provider still insists on a key. Goes nowhere. */
export const REPLAY_PLACEHOLDER_KEY = "replay-no-key";
