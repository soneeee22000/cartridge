import { randomUUID } from "node:crypto";
import { z } from "zod";
import { attributionForThrown, driverAttribution } from "./attribution.ts";
import type { Clock } from "./clock.ts";
import { mapWorkflowChunk, type ProgressEvent } from "./events.ts";
import { HEARTBEAT_INTERVAL_MS, settlement } from "./lifecycle.ts";
import type { RunRow, RunStore } from "./run-store/types.ts";
import { RunOutput, type Attribution, type FinalizeOut } from "./schemas.ts";
import type { StartWorkflowStream, WorkflowHandle } from "./workflow-port.ts";

export type DriveOutcome =
  "not-claimed" | "complete" | "released" | "abandoned" | "lease-lost";

export interface DriverDeps {
  readonly store: RunStore;
  readonly clock: Clock;
  /** Names the process; each claim writes under its own lease id derived from it. */
  readonly owner: string;
  readonly startWorkflowStream: StartWorkflowStream;
  readonly signal?: AbortSignal | undefined;
}

const FinishChunk = z.object({
  type: z.literal("workflow-finish"),
  payload: z.object({ workflowStatus: z.string() }),
});
const WorkflowResult = z.object({
  status: z.string(),
  result: z.unknown().optional(),
});

const ABORTED = Symbol("aborted");

interface Session {
  readonly runId: string;
  readonly deps: DriverDeps;
  /** Per-claim lease id: the fencing token every write carries (§5.2 invariant 7). */
  readonly lease: string;
  readonly row: RunRow;
  lastBeat: number;
  leaseLost: boolean;
  sealing: boolean;
  handle: WorkflowHandle | null;
}

type PumpResult =
  | { readonly kind: "finished"; readonly status: string }
  | { readonly kind: "cut" }
  | { readonly kind: "aborted" }
  | { readonly kind: "lease-lost" };

function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | typeof ABORTED> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      resolve(ABORTED);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Renews the claim. The stream path is throttled to one beat per interval; the timer forces a
 * beat on every tick, so an early tick never doubles the gap. Once sealing has begun the seal
 * lease governs the row and nothing is renewed.
 */
async function keepLease(session: Session, force = false): Promise<boolean> {
  if (session.leaseLost) return false;
  if (session.sealing) return true;
  const now = session.deps.clock.now();
  if (!force && now - session.lastBeat < HEARTBEAT_INTERVAL_MS) return true;
  session.lastBeat = now;
  const held = await session.deps.store.heartbeat(
    session.runId,
    session.lease,
    now,
  );
  if (!held) session.leaseLost = true;
  return held;
}

async function record(session: Session, event: ProgressEvent): Promise<void> {
  if (session.leaseLost) return;
  const seq = await session.deps.store.appendEvent(
    session.runId,
    session.lease,
    event,
  );
  if (seq === null) session.leaseLost = true;
}

async function pump(
  session: Session,
  handle: WorkflowHandle,
): Promise<PumpResult> {
  const iterator = handle.fullStream[Symbol.asyncIterator]();
  let status: string | null = null;
  for (;;) {
    const next = await abortable(iterator.next(), session.deps.signal);
    if (next === ABORTED) return { kind: "aborted" };
    if (next.done === true) break;
    if (!(await keepLease(session))) return { kind: "lease-lost" };
    for (const event of mapWorkflowChunk(next.value))
      await record(session, event);
    if (session.leaseLost) return { kind: "lease-lost" };
    const finish = FinishChunk.safeParse(next.value);
    if (finish.success) status = finish.data.payload.workflowStatus;
  }
  return status === null ? { kind: "cut" } : { kind: "finished", status };
}

async function settle(
  session: Session,
  attribution: Attribution,
): Promise<DriveOutcome> {
  if (session.leaseLost) return "lease-lost";
  const { store } = session.deps;
  await record(session, { kind: "run.released", data: { attribution } });
  const action = settlement(attribution, session.row);
  const won =
    action === "release"
      ? await store.release(session.runId, session.lease, attribution)
      : await store.abandon(session.runId, session.lease, attribution);
  if (!won) return "lease-lost";
  return action === "release" ? "released" : "abandoned";
}

async function seal(
  session: Session,
  output: FinalizeOut,
): Promise<DriveOutcome> {
  if (session.leaseLost) return "lease-lost";
  const { store, clock } = session.deps;
  if (!(await store.beginSeal(session.runId, session.lease, clock.now())))
    return "lease-lost";
  session.sealing = true;
  const { spec, artifact, html, verdict } = output;
  const committed = {
    version: artifact.version,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    html,
  };
  const done = await store.completeSeal(session.runId, session.lease, {
    spec,
    artifact: committed,
    e1Score: verdict.score,
  });
  return done ? "complete" : "lease-lost";
}

async function conclude(
  session: Session,
  handle: WorkflowHandle,
  status: string,
): Promise<DriveOutcome> {
  if (status === "canceled")
    return settle(
      session,
      driverAttribution("stream-cut", "the workflow was canceled"),
    );
  const result = WorkflowResult.parse(await handle.result);
  if (result.status !== "success")
    return settle(
      session,
      driverAttribution(
        "engine-crashed",
        `workflow ended with status ${result.status}`,
      ),
    );
  const output = RunOutput.parse(result.result);
  if (output.finalize) return seal(session, output.finalize);
  if (output.reject) return settle(session, output.reject.attribution);
  return settle(
    session,
    driverAttribution(
      "engine-crashed",
      "workflow succeeded without a branch output",
    ),
  );
}

async function stopHandle(session: Session): Promise<void> {
  await session.handle?.cancel().catch(() => undefined);
}

async function run(session: Session): Promise<DriveOutcome> {
  const context = {
    runKey: session.row.runKey,
    claimAttempt: session.row.claims,
    buildAttempt: 0,
  };
  const input = { runKey: session.row.runKey, prompt: session.row.prompt };
  const handle = await session.deps.startWorkflowStream(input, context);
  session.handle = handle;
  const pumped = await pump(session, handle);
  if (pumped.kind === "lease-lost") {
    await stopHandle(session);
    return "lease-lost";
  }
  if (pumped.kind === "aborted") {
    await stopHandle(session);
    return settle(
      session,
      driverAttribution("stream-cut", "the request was aborted"),
    );
  }
  if (pumped.kind === "cut")
    return settle(
      session,
      driverAttribution(
        "stream-cut",
        "the workflow stream ended without workflow-finish",
      ),
    );
  return conclude(session, handle, pumped.status);
}

async function beat(session: Session): Promise<void> {
  try {
    if (!(await keepLease(session, true))) await stopHandle(session);
  } catch {
    return;
  }
}

/**
 * A heartbeat that throws (a busy database, say) is skipped: the claim stays until the next tick
 * or until it goes stale, and a lost lease is still caught by the next beat or fenced write.
 */
function startHeartbeat(session: Session): NodeJS.Timeout {
  const timer = setInterval(() => {
    void beat(session);
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return timer;
}

/**
 * Drives one run (§5.4): claim, stream the workflow into the event log with heartbeats, then seal,
 * release or abandon. Every write carries a lease id minted for this claim, so a second claim of
 * the same run, even from the same process, fences this one out. A lost lease, seen by a heartbeat
 * or by a refused event append, stops everything and writes nothing further; an aborted signal
 * cancels the run and releases it with `stream-cut`.
 * @param runId run row id
 * @param deps store, clock, owner id, workflow port and optional abort signal
 */
export async function driveRun(
  runId: string,
  deps: DriverDeps,
): Promise<DriveOutcome> {
  const lease = `${deps.owner}/${randomUUID()}`;
  if (!(await deps.store.claim(runId, lease, deps.clock.now())))
    return "not-claimed";
  const row = await deps.store.get(runId);
  if (!row) return "not-claimed";
  const session: Session = {
    runId,
    deps,
    lease,
    row,
    lastBeat: deps.clock.now(),
    leaseLost: false,
    sealing: false,
    handle: null,
  };
  await record(session, {
    kind: "run.claimed",
    data: { claimAttempt: row.claims },
  });
  const timer = startHeartbeat(session);
  try {
    return await run(session);
  } catch (error) {
    await stopHandle(session);
    if (session.leaseLost) return "lease-lost";
    return await settle(session, attributionForThrown(error));
  } finally {
    clearInterval(timer);
  }
}
