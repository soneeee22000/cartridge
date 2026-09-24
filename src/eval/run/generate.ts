import type { MastraModelConfig } from "@mastra/core/llm";
import type { ArtifactStore } from "../../engine/artifacts/types.ts";
import { createCartridge } from "../../engine/cartridge.ts";
import type { Clock } from "../../engine/clock.ts";
import { driveRun } from "../../engine/driver.ts";
import type { ProgressEvent } from "../../engine/events.ts";
import { MAX_CLAIMS_EVAL } from "../../engine/lifecycle.ts";
import { MemoryRunStore } from "../../engine/run-store/memory.ts";
import type { RunRow } from "../../engine/run-store/types.ts";
import { ZERO_USAGE, addUsage, type Usage } from "../../engine/usage.ts";
import { cartridgePort } from "../../engine/workflow-port.ts";
import { MODEL_IDS } from "../../models/port.ts";
import type { DatasetItem } from "../dataset/schema.ts";
import { PRICE_TABLE_VERSION } from "../pricing.ts";
import type { ItemFailure } from "../report/types.ts";
import { RUN_RECORD_FORMAT, type RunRecord } from "./record.ts";

/**
 * Slowest item measured across the four paid `sample` recordings of 2026-09-24: `bubble-pop` with
 * four build attempts (the one item that exhausted its repairs), from its `run.json`.
 */
export const SLOWEST_MEASURED_ITEM_MS = 143_177;
/** Headroom over the slowest measured item. Design choice. */
const TIMEOUT_HEADROOM = 3;
/** Wall-clock cap per item: a multiple of the slowest measured item (§12.2). */
export const ITEM_TIMEOUT_MS = TIMEOUT_HEADROOM * SLOWEST_MEASURED_ITEM_MS;

export interface GenerateDeps {
  readonly models: {
    readonly planner: MastraModelConfig;
    readonly builder: MastraModelConfig;
  };
  readonly artifacts: ArtifactStore;
  readonly clock: Clock;
  readonly timeoutMs: number;
}

interface EventSummary {
  readonly buildAttempts: number;
  readonly repairRules: string[];
  readonly usage: RunRecord["usage"];
}

function summariseEvents(events: readonly ProgressEvent[]): EventSummary {
  let plan: Usage = ZERO_USAGE;
  let generate: Usage = ZERO_USAGE;
  let repair: Usage = ZERO_USAGE;
  let buildAttempts = 0;
  const repairRules: string[] = [];
  for (const event of events) {
    if (event.kind === "verify.verdict") buildAttempts += 1;
    if (event.kind === "repair.start")
      repairRules.push(...event.data.fromRules);
    if (event.kind !== "usage") continue;
    if (event.data.phase === "plan") plan = addUsage(plan, event.data.usage);
    else generate = addUsage(generate, event.data.usage);
    if (event.data.phase === "generate" && event.data.buildAttempt > 0)
      repair = addUsage(repair, event.data.usage);
  }
  return { buildAttempts, repairRules, usage: { plan, generate, repair } };
}

function failureOf(row: RunRow | null, timedOut: boolean): ItemFailure | null {
  if (row?.status === "complete") return null;
  if (timedOut) return { step: "driver", code: "timeout", ruleIds: [] };
  const attribution = row?.attribution;
  if (!attribution) return { step: "driver", code: "not-settled", ruleIds: [] };
  const { step, code, ruleIds } = attribution;
  return { step, code, ruleIds };
}

async function drive(
  item: DatasetItem,
  store: MemoryRunStore,
  deps: GenerateDeps,
): Promise<boolean> {
  const runId = `eval-${item.id}`;
  await store.create({
    id: runId,
    runKey: item.id,
    prompt: item.prompt,
    maxClaims: MAX_CLAIMS_EVAL,
  });
  const signal = AbortSignal.timeout(deps.timeoutMs);
  const startWorkflowStream = cartridgePort(() =>
    createCartridge({ models: deps.models, artifacts: deps.artifacts }),
  );
  await driveRun(runId, {
    store,
    clock: deps.clock,
    owner: "eval-cli",
    startWorkflowStream,
    signal,
  });
  return signal.aborted;
}

/**
 * Generates one dataset item through the real driver and workflow, with `MAX_CLAIMS_EVAL = 1`
 * so the item's cost and outcome belong to exactly one generation (§5.2). A timeout or an error
 * escaping the driver is recorded as a harness failure, never thrown.
 * @param item the dataset item; its id is the run key
 * @param deps models, artifact store, clock and timeout
 */
export async function generateItem(
  item: DatasetItem,
  deps: GenerateDeps,
): Promise<RunRecord> {
  const store = new MemoryRunStore(deps.clock);
  const started = deps.clock.now();
  let timedOut = false;
  let crashed = false;
  try {
    timedOut = await drive(item, store, deps);
  } catch {
    crashed = true;
  }
  const row = await store.get(`eval-${item.id}`);
  const events = (await store.listEvents(`eval-${item.id}`, 0)).map(
    (stored) => stored.event,
  );
  const summary = summariseEvents(events);
  const failure = crashed
    ? { step: "driver", code: "harness-error", ruleIds: [] }
    : failureOf(row, timedOut);
  const artifact = row?.status === "complete" ? row.artifact : null;
  return {
    format: RUN_RECORD_FORMAT,
    itemId: item.id,
    status: row?.status ?? "missing",
    failure,
    spec: row?.spec ?? null,
    artifact: artifact
      ? {
          version: artifact.version,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
        }
      : null,
    ...summary,
    wallMs: deps.clock.now() - started,
    models: { planner: MODEL_IDS.planner, builder: MODEL_IDS.builder },
    priceTableVersion: PRICE_TABLE_VERSION,
  };
}
