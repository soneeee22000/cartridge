/**
 * Every engine limit (§4.4). All values are starting values: "arbitrary cap, not tuned" until the
 * `sample` tier replaces one with a measured value, and the comment then names that source.
 */

/** Repair passes after the initial generation. Design choice. */
export const MAX_REPAIRS = 3;
/** Agent steps inside one generate phase. Arbitrary cap, not tuned. */
export const GENERATE_MAX_STEPS = 6;
/** Agent steps inside plan. Arbitrary cap, not tuned. */
export const PLAN_MAX_STEPS = 4;
/** `maxOutputTokens` per builder call. Arbitrary cap, not tuned. */
export const BUILDER_MAX_OUTPUT_TOKENS = 48_000;
/** `maxOutputTokens` per planner call. Arbitrary cap, not tuned. */
export const PLANNER_MAX_OUTPUT_TOKENS = 4_000;
/** `maxOutputTokens` per E3 judge call. Arbitrary cap, not tuned. */
export const JUDGE_MAX_OUTPUT_TOKENS = 4_000;
/** Total tokens (all kinds) spent in repair passes. Arbitrary cap, not tuned. */
export const REPAIR_TOKEN_BUDGET = 300_000;
/** Total tokens (all kinds) for the whole run. Arbitrary cap, not tuned. */
export const RUN_TOKEN_BUDGET = 520_000;
/** Upper bound on one HTML artifact, in UTF-8 bytes. Arbitrary cap, not tuned. */
export const MAX_GAME_BYTES = 120_000;

/**
 * Thinking mode per role, sent as `providerOptions.anthropic` (shape read from
 * `@ai-sdk/anthropic@4.0.62`'s `anthropicLanguageModelOptions`). Disabled so output length and
 * recordings do not vary with adaptive thinking. Starting choice, not tuned.
 */
export const BUILDER_THINKING = { thinking: { type: "disabled" } } as const;
export const PLANNER_THINKING = { thinking: { type: "disabled" } } as const;
