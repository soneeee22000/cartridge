import { addUsage, ZERO_USAGE } from "../../engine/usage.ts";
import type { DatasetItem } from "../dataset/schema.ts";
import { scoreGame } from "../e1/score.ts";
import type { E2Result } from "../e2/types.ts";
import type { JudgeInput, Judged } from "../e3/judge.ts";
import { matchLanguage } from "../e4/match.ts";
import { outcomeOf, type ItemRecord } from "../report/types.ts";
import type { RunRecord } from "./record.ts";

/** Runs E3 for one game; returns null when no judge is available. */
export type JudgeFn = (input: JudgeInput) => Promise<Judged | null>;

export interface EvaluateInputs {
  readonly item: DatasetItem;
  readonly record: RunRecord;
  readonly html: string | null;
  readonly e2: E2Result | null;
  readonly judge: JudgeFn;
}

type Quality = Pick<ItemRecord, "e1Score" | "e2" | "e3" | "e4">;

const NO_QUALITY: Quality = { e1Score: null, e2: null, e3: null, e4: null };

async function quality(
  inputs: EvaluateInputs,
): Promise<{ quality: Quality; judged: Judged | null }> {
  const { item, record, html } = inputs;
  const spec = record.spec;
  if (!html || !spec) return { quality: NO_QUALITY, judged: null };
  const judged = await inputs.judge({ prompt: item.prompt, spec, html });
  return {
    judged,
    quality: {
      e1Score: scoreGame(html, { spec }).verdict.score,
      e2: inputs.e2,
      e3: judged?.result ?? null,
      e4: matchLanguage(item.lang, html, spec.slug),
    },
  };
}

/**
 * Builds one item's report record from its settled run (§11.3). E1 and E4 are recomputed from the
 * game, E3 comes from the judge (replayed from cassettes when rescoring), and E2 and wall time are
 * read from what the run wrote. Quality is measured only for items that produced a game.
 * @param inputs the item, its run record, its game, its E2 result and a judge
 */
export async function evaluateItem(
  inputs: EvaluateInputs,
): Promise<ItemRecord> {
  const { item, record } = inputs;
  const outcome = outcomeOf(record.status, record.failure?.code ?? null);
  const measured =
    outcome === "game"
      ? await quality(inputs)
      : { quality: NO_QUALITY, judged: null };
  return {
    id: item.id,
    lengthBand: item.lengthBand,
    lang: item.lang,
    intendedType: item.intendedType,
    gameType: record.spec?.gameType ?? null,
    outcome,
    failure: record.failure,
    ...measured.quality,
    buildAttempts: record.buildAttempts,
    repairRules: record.repairRules,
    usage: {
      generator: addUsage(record.usage.plan, record.usage.generate),
      judge: measured.judged?.usage ?? ZERO_USAGE,
    },
    repairUsage: record.usage.repair,
    wallMs: record.wallMs,
  };
}
