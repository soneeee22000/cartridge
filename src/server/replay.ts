import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MemoryArtifactStore } from "../engine/artifacts/memory.ts";
import { createCartridge } from "../engine/cartridge.ts";
import { systemClock, type Sleep } from "../engine/clock.ts";
import { driveRun } from "../engine/driver.ts";
import { MAX_CLAIMS_EVAL } from "../engine/lifecycle.ts";
import { lastEventIdOf, relayRun, type RelayOptions } from "../engine/relay.ts";
import { MemoryRunStore } from "../engine/run-store/memory.ts";
import { cartridgePort } from "../engine/workflow-port.ts";
import { Dataset, DatasetLang, LengthBand } from "../eval/dataset/schema.ts";
import type { CassettePace } from "../models/cassette.ts";
import { replayModel } from "../models/replay.ts";
import type { WebHandler } from "./node-adapter.ts";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const DATASET_FILE = join("dataset", "prompts.v1.json");
const REPORT_FILE = join("reports", "committed", "full.json");
const PromptId = z.string().regex(/^[a-z0-9-]{3,40}$/);
const VisitorPace = z.enum(["fast", "recorded"]).default("fast");

export const ReplayEntry = z.object({
  id: z.string(),
  lang: DatasetLang,
  lengthBand: LengthBand,
  prompt: z.string(),
  buildAttempts: z.number().int().positive(),
});
export type ReplayEntry = z.infer<typeof ReplayEntry>;

const ReportItems = z.object({
  items: z.array(z.object({ id: z.string(), buildAttempts: z.number() })),
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/**
 * The prompts a visitor can replay: dataset items that have committed cassettes, with the build
 * attempts their recorded run took. Items that went through a repair come first, so the default
 * choice shows the repair loop.
 * @param root directory holding `dataset/`, `cassettes/` and `reports/committed/`
 */
export function loadReplayCatalog(root: string): ReplayEntry[] {
  const dataset = Dataset.parse(readJson(join(root, DATASET_FILE)));
  const report = ReportItems.parse(readJson(join(root, REPORT_FILE)));
  const attempts = new Map(
    report.items.map((item) => [item.id, item.buildAttempts]),
  );
  const entries = dataset.items
    .filter((item) =>
      existsSync(join(root, "cassettes", item.id, "index.json")),
    )
    .filter((item) => (attempts.get(item.id) ?? 0) > 0)
    .map((item) =>
      ReplayEntry.parse({
        id: item.id,
        lang: item.lang,
        lengthBand: item.lengthBand,
        prompt: item.prompt,
        buildAttempts: attempts.get(item.id),
      }),
    );
  return entries.sort(
    (a, b) => Number(b.buildAttempts > 1) - Number(a.buildAttempts > 1),
  );
}

export interface ReplayHandlerOptions {
  readonly root: string;
  /** Overrides the visitor's `?pace=`; tests pass `instant`. */
  readonly pace?: CassettePace;
  readonly sleep?: Sleep;
  readonly relay?: Pick<RelayOptions, "clock" | "sleep" | "pollMs">;
}

/**
 * `GET /api/prompts`: the replay catalog as JSON.
 * @param options asset root
 */
export function createPromptsHandler(
  options: Pick<ReplayHandlerOptions, "root">,
): WebHandler {
  const items = loadReplayCatalog(options.root);
  return () =>
    Response.json(
      { items },
      { headers: { "cache-control": "public, max-age=300" } },
    );
}

interface ReplayRun {
  readonly store: MemoryRunStore;
  readonly runId: string;
  readonly cassetteDir: string;
  readonly pace: CassettePace;
}

function startReplay(
  run: ReplayRun,
  options: ReplayHandlerOptions,
  signal: AbortSignal,
): void {
  const { store, runId, cassetteDir, pace } = run;
  const replayOptions = { cassetteDir, pace, sleep: options.sleep };
  const models = {
    planner: replayModel("planner", replayOptions),
    builder: replayModel("builder", replayOptions),
  };
  const startWorkflowStream = cartridgePort(() =>
    createCartridge({ models, artifacts: new MemoryArtifactStore() }),
  );
  driveRun(runId, {
    store,
    clock: systemClock,
    owner: "replay",
    startWorkflowStream,
    signal,
  }).catch((error: unknown) => {
    process.stderr.write(`replay ${runId} failed: ${String(error)}\n`);
  });
}

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * `GET /api/replay?promptId=`: runs the real workflow, driver and verifiers for one catalog item
 * with every model call served from its committed cassette, and relays the run as SSE in the
 * same invocation (ADR-0003). The model mode is fixed to replay: no key, no network. `?pace=fast`
 * (the default) divides the recorded gaps by `FAST_FORWARD_FACTOR`; `?pace=recorded` keeps them.
 * A reconnect re-runs the replay and the relay skips what the client already has.
 * @param options asset root, cassette pace and relay timing
 */
export function createReplayHandler(options: ReplayHandlerOptions): WebHandler {
  const allowed = new Map(
    loadReplayCatalog(options.root).map((entry) => [entry.id, entry]),
  );
  return async (request) => {
    if (request.method !== "GET")
      return errorResponse(HTTP_METHOD_NOT_ALLOWED, "method not allowed");
    const params = new URL(request.url).searchParams;
    const parsed = PromptId.safeParse(params.get("promptId"));
    const pace = VisitorPace.safeParse(params.get("pace") ?? undefined);
    if (!parsed.success || !pace.success)
      return errorResponse(
        HTTP_BAD_REQUEST,
        "expected ?promptId=<item id>&pace=fast|recorded",
      );
    const entry = allowed.get(parsed.data);
    if (!entry) return errorResponse(HTTP_NOT_FOUND, "unknown prompt id");
    const store = new MemoryRunStore(systemClock);
    const runId = `replay-${randomUUID()}`;
    await store.create({
      id: runId,
      runKey: entry.id,
      prompt: entry.prompt,
      maxClaims: MAX_CLAIMS_EVAL,
    });
    const cassetteDir = join(options.root, "cassettes", entry.id);
    const runPace = options.pace ?? pace.data;
    startReplay(
      { store, runId, cassetteDir, pace: runPace },
      options,
      request.signal,
    );
    return relayRun({
      ...options.relay,
      store,
      runId,
      lastEventId: lastEventIdOf(request),
      signal: request.signal,
    });
  };
}
