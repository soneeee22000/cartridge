import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { Sleep } from "../engine/clock.ts";
import { anthropicModel } from "./anthropic.ts";
import { cassetteFetch, type CassettePace } from "./cassette.ts";
import { MODEL_IDS, REPLAY_PLACEHOLDER_KEY, type ModelRole } from "./ids.ts";

/** The cassette directory to replay from, and how to pace it. */
export interface ReplayModelOptions {
  readonly cassetteDir: string;
  readonly pace?: CassettePace | undefined;
  readonly sleep?: Sleep | undefined;
}

/**
 * A model that can only replay committed cassettes: no key is read and no upstream exists, so a
 * cassette miss fails instead of reaching the network. The public `api/` handlers use this, never
 * `createModel`, so they cannot reach the live or record paths (ADR-0003).
 * @param role planner or builder
 * @param options cassette directory and pace
 */
export function replayModel(
  role: ModelRole,
  options: ReplayModelOptions,
): LanguageModelV4 {
  const modelId = MODEL_IDS[role];
  const fetch = cassetteFetch({
    mode: "replay",
    dir: options.cassetteDir,
    role,
    model: modelId,
    pace: options.pace,
    sleep: options.sleep,
  });
  return anthropicModel(modelId, { apiKey: REPLAY_PLACEHOLDER_KEY, fetch });
}
