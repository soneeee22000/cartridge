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
const HTTP_NO_CONTENT = 204;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_TOO_MANY_REQUESTS = 429;
/** Replays one function instance runs at once before answering 429 (arbitrary). */
export const MAX_CONCURRENT_REPLAYS = 8;
const DATASET_FILE = join("dataset", "prompts.v1.json");
const REPORT_FILE = join("reports", "committed", "full.json");
const PromptId = z.string().regex(/^[a-z0-9-]{3,40}$/);
const VisitorPace = z.enum(["fast", "recorded"]).default("fast");

/** One replayable prompt, as `GET /api/prompts` lists it. */
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

/** Where the assets live, and test overrides for pace, sleep, concurrency and relay timing. */
export interface ReplayHandlerOptions {
  readonly root: string;
  /** Overrides the visitor's `?pace=`; tests pass `instant`. */
  readonly pace?: CassettePace;
  readonly sleep?: Sleep;
  readonly maxConcurrent?: number;
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

interface ReplayState {
  readonly options: ReplayHandlerOptions;
  readonly terminalIds: Map<string, number>;
  running: number;
}

async function rememberTerminal(
  state: ReplayState,
  run: ReplayRun,
  itemId: string,
): Promise<void> {
  const row = await run.store.get(run.runId);
  if (row?.status !== "complete" && row?.status !== "abandoned") return;
  const events = await run.store.listEvents(run.runId, 0);
  state.terminalIds.set(itemId, (events.at(-1)?.seq ?? 0) + 1);
}

function startReplay(
  run: ReplayRun,
  options: ReplayHandlerOptions,
  signal: AbortSignal,
): Promise<void> {
  const { store, runId, cassetteDir, pace } = run;
  const replayOptions = { cassetteDir, pace, sleep: options.sleep };
  const models = {
    planner: replayModel("planner", replayOptions),
    builder: replayModel("builder", replayOptions),
  };
  const startWorkflowStream = cartridgePort(() =>
    createCartridge({ models, artifacts: new MemoryArtifactStore() }),
  );
  return driveRun(runId, {
    store,
    clock: systemClock,
    owner: "replay",
    startWorkflowStream,
    signal,
  }).then(
    () => undefined,
    (error: unknown) => {
      process.stderr.write(`replay ${runId} failed: ${String(error)}\n`);
    },
  );
}

async function serveReplay(
  state: ReplayState,
  entry: ReplayEntry,
  pace: CassettePace,
  request: Request,
): Promise<Response> {
  const lastEventId = lastEventIdOf(request);
  const store = new MemoryRunStore(systemClock);
  const run: ReplayRun = {
    store,
    runId: `replay-${randomUUID()}`,
    cassetteDir: join(state.options.root, "cassettes", entry.id),
    pace: state.options.pace ?? (lastEventId === null ? pace : "instant"),
  };
  await store.create({
    id: run.runId,
    runKey: entry.id,
    prompt: entry.prompt,
    maxClaims: MAX_CLAIMS_EVAL,
  });
  state.running += 1;
  startReplay(run, state.options, request.signal)
    .then(() => rememberTerminal(state, run, entry.id))
    .finally(() => {
      state.running -= 1;
    })
    .catch(() => undefined);
  return relayRun({
    ...state.options.relay,
    store,
    runId: run.runId,
    lastEventId,
    signal: request.signal,
  });
}

function alreadyFinished(
  state: ReplayState,
  itemId: string,
  request: Request,
): boolean {
  const lastEventId = lastEventIdOf(request);
  const terminalId = state.terminalIds.get(itemId);
  return (
    lastEventId !== null &&
    terminalId !== undefined &&
    lastEventId >= terminalId
  );
}

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * `GET /api/replay?promptId=`: runs the real workflow, driver and verifiers for one catalog item
 * with every model call served from its committed cassette, and relays the run as SSE in the
 * same invocation (ADR-0003). The model mode is fixed to replay: no key, no network. `?pace=fast`
 * (the default) divides the recorded gaps by `FAST_FORWARD_FACTOR`; `?pace=recorded` keeps them.
 * A reconnect re-runs the replay at instant pace and the relay skips what the client already has;
 * once this instance has seen an item finish, a reconnect at or past its terminal id gets 204.
 * Each instance runs at most `MAX_CONCURRENT_REPLAYS` at once and answers 429 beyond that.
 * @param options asset root, cassette pace and relay timing
 */
export function createReplayHandler(options: ReplayHandlerOptions): WebHandler {
  const allowed = new Map(
    loadReplayCatalog(options.root).map((entry) => [entry.id, entry]),
  );
  const state: ReplayState = { options, terminalIds: new Map(), running: 0 };
  const limit = options.maxConcurrent ?? MAX_CONCURRENT_REPLAYS;
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
    if (alreadyFinished(state, entry.id, request))
      return new Response(null, { status: HTTP_NO_CONTENT });
    if (state.running >= limit)
      return errorResponse(
        HTTP_TOO_MANY_REQUESTS,
        "too many replays running; try again shortly",
      );
    return serveReplay(state, entry, pace.data, request);
  };
}
