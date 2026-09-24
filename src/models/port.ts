import type { LanguageModelV4 } from "@ai-sdk/provider";
import { z } from "zod";
import type { Sleep } from "../engine/clock.ts";
import { anthropicModel } from "./anthropic.ts";
import {
  cassetteFetch,
  type CassettePace,
  type FetchLike,
} from "./cassette.ts";
import {
  MODEL_IDS,
  REPLAY_PLACEHOLDER_KEY,
  type ModelRole,
} from "./ids.ts";

export {
  MODEL_IDS,
  MODEL_ROLES,
  REPLAY_PLACEHOLDER_KEY,
  type ModelRole,
} from "./ids.ts";

export const MODEL_MODES = ["live", "record", "replay", "mock"] as const;
export const ModelMode = z.enum(MODEL_MODES);
export type ModelMode = z.infer<typeof ModelMode>;

const DEFAULT_MODE: ModelMode = "replay";

/** A scripted model for tests and the dev server's mock mode (built by `mock.ts`). */
export type MockScript = LanguageModelV4;

export interface CreateModelOptions {
  readonly cassetteDir?: string | undefined;
  readonly mock?: MockScript | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly upstream?: FetchLike | undefined;
  readonly pace?: CassettePace | undefined;
  readonly sleep?: Sleep | undefined;
}

/** `live` or `record` was requested without `ANTHROPIC_API_KEY`. */
export class MissingApiKeyError extends Error {
  override readonly name = "MissingApiKeyError";
}

/**
 * Reads `CARTRIDGE_MODEL_MODE`; the default is `replay`.
 * @param env environment to read
 */
export function modelModeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ModelMode {
  const raw = env.CARTRIDGE_MODEL_MODE;
  return raw === undefined || raw === "" ? DEFAULT_MODE : ModelMode.parse(raw);
}

function requireKey(options: CreateModelOptions, mode: ModelMode): string {
  const key = options.env?.ANTHROPIC_API_KEY;
  if (!key)
    throw new MissingApiKeyError(`${mode} mode needs ANTHROPIC_API_KEY`);
  return key;
}

function requireDir(options: CreateModelOptions, mode: ModelMode): string {
  if (!options.cassetteDir) throw new Error(`${mode} mode needs a cassetteDir`);
  return options.cassetteDir;
}

/**
 * The model factory every role goes through (§7.1).
 * @param role planner, builder or judge
 * @param mode live, record, replay or mock
 * @param options cassette directory, mock script and environment
 */
export function createModel(
  role: ModelRole,
  mode: ModelMode,
  options: CreateModelOptions,
): LanguageModelV4 {
  const modelId = MODEL_IDS[role];
  if (mode === "mock") {
    if (!options.mock) throw new Error("mock mode needs a mock script");
    return options.mock;
  }
  if (mode === "live")
    return anthropicModel(modelId, {
      apiKey: requireKey(options, mode),
      fetch: options.upstream,
    });
  const apiKey =
    mode === "record" ? requireKey(options, mode) : REPLAY_PLACEHOLDER_KEY;
  const fetch = cassetteFetch({
    mode,
    dir: requireDir(options, mode),
    role,
    model: modelId,
    upstream: options.upstream,
    pace: options.pace,
    sleep: options.sleep,
  });
  return anthropicModel(modelId, { apiKey, fetch });
}
