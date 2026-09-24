import { z } from "zod";
import { GameType } from "../../contract/game-types.ts";
import { Usage } from "../../engine/usage.ts";
import { DatasetLang, LengthBand } from "../dataset/schema.ts";
import { E2Result } from "../e2/types.ts";
import { E3Result } from "../e3/validate.ts";
import { DIMENSIONS } from "../e3/rubric.ts";
import { LabelledStats } from "../e4/labelled.ts";
import { E4Result } from "../e4/match.ts";
import { TIERS } from "../tiers.ts";

export const REPORT_FORMAT = "cartridge-report/1";

export const OUTCOMES = [
  "game",
  "contract-failed",
  "refusal",
  "harness-failure",
] as const;
export const Outcome = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof Outcome>;

/** A model output that failed the contract or produced no usable plan or page (§11.3). */
const CONTRACT_CODES: ReadonlySet<string> = new Set([
  "contract-unmet",
  "budget-exhausted",
  "generate-truncated",
  "plan-invalid-spec",
  "generate-no-artifact",
]);
const REFUSAL_CODE = "model-refusal";

/**
 * Maps a settled run onto exactly one report outcome (§11.3). Anything that is not a game, a
 * contract failure or a refusal is a harness failure: our code, a cassette miss, a provider error,
 * a cut stream, a timeout, or a row that never reached a terminal state.
 * @param status the run row's status after the driver returned
 * @param code the attributed failure code, or a harness code such as `timeout`
 */
export function outcomeOf(status: string, code: string | null): Outcome {
  if (status === "complete") return "game";
  if (status !== "abandoned" || code === null) return "harness-failure";
  if (CONTRACT_CODES.has(code)) return "contract-failed";
  return code === REFUSAL_CODE ? "refusal" : "harness-failure";
}

export const ItemFailure = z.object({
  step: z.string(),
  code: z.string(),
  ruleIds: z.array(z.string()),
});
export type ItemFailure = z.infer<typeof ItemFailure>;

/** Everything the report needs about one dataset item. */
export const ItemRecord = z.object({
  id: z.string(),
  lengthBand: LengthBand,
  lang: DatasetLang,
  intendedType: GameType.nullable(),
  gameType: GameType.nullable(),
  outcome: Outcome,
  failure: ItemFailure.nullable(),
  e1Score: z.number().nullable(),
  e2: E2Result.nullable(),
  e3: E3Result.nullable(),
  e4: E4Result.nullable(),
  buildAttempts: z.int().min(0),
  repairRules: z.array(z.string()),
  usage: z.object({ generator: Usage, judge: Usage }),
  repairUsage: Usage,
  wallMs: z.number().nullable(),
});
export type ItemRecord = z.infer<typeof ItemRecord>;

const Count = z.int().min(0);
const Tally = z.record(z.string(), Count);

export const BandRow = z.object({
  band: LengthBand,
  n: Count,
  games: Count,
  contractFailed: Count,
  refusals: Count,
  harnessFailures: Count,
  e1: z.object({ mean: z.number(), min: z.number() }).nullable(),
  e2: z.object({ probed: Count, passed: Count, detectorFails: Tally }),
  e3: z.record(z.enum(DIMENSIONS), Tally),
  e4: z.object({ match: Count, mismatch: Count, abstain: Count }),
  medianBuildAttempts: z.number().nullable(),
});
export type BandRow = z.infer<typeof BandRow>;

/** Counts and cost across bands. Deliberately holds no quality metric (§11.3). */
export const Totals = z.object({
  n: Count,
  games: Count,
  contractFailed: Count,
  refusals: Count,
  harnessFailures: Count,
  estUsd: z.number(),
});
export type Totals = z.infer<typeof Totals>;

/** `report.json` under schema `cartridge-report/1` (§11.3). */
export const ReportJson = z.object({
  format: z.literal(REPORT_FORMAT),
  header: z.object({
    tier: z.enum(TIERS),
    label: z.string(),
    datasetVersion: z.string(),
    models: z.object({
      planner: z.string(),
      builder: z.string(),
      judge: z.string(),
    }),
    priceTableVersion: z.string(),
  }),
  bands: z.array(BandRow),
  totals: Totals,
  repair: z.object({ histogram: Tally, triggers: Tally }),
  failures: z.record(z.string(), Tally),
  cost: z.object({
    tokens: z.object({ generator: Usage, judge: Usage }),
    repairTokens: Usage,
    repairCacheRead: Count,
    estUsd: z.number(),
    usdLabel: z.string(),
    wallMsTotal: z.number(),
    wallMsMedian: z.number().nullable(),
  }),
  e4Labelled: LabelledStats.extend({ note: z.string() }),
  notMeasured: z.array(z.string()),
  noiseFloor: z.string(),
  items: z.array(ItemRecord),
});
export type ReportJson = z.infer<typeof ReportJson>;
