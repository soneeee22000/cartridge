import { driverAttribution } from "../engine/attribution.ts";
import type { Clock } from "../engine/clock.ts";
import { canClaim, canReap } from "../engine/lifecycle.ts";
import type { RunStore } from "../engine/run-store/types.ts";

/** How often the dev server sweeps open rows. Arbitrary, not tuned; below `STALE_ACTIVE_MS`. */
export const SWEEP_INTERVAL_MS = 30_000;

export interface SweepDeps {
  readonly store: RunStore;
  readonly clock: Clock;
  readonly enqueue: (runId: string) => void;
}

const REAPED = driverAttribution(
  "lease-lost",
  "the last claim stopped renewing its lease and no claims are left",
);

/**
 * One pass over the open rows (§5.4): a row nobody can claim again is abandoned with `lease-lost`,
 * and a row that can be claimed (waiting, or stale with claims left) is queued. Rows another
 * driver holds are left alone.
 * @param deps run store, clock and queue
 */
export async function sweepRuns(deps: SweepDeps): Promise<void> {
  const now = deps.clock.now();
  for (const row of await deps.store.listOpen()) {
    if (canReap(row, now)) await deps.store.reap(row.id, now, REAPED);
    else if (canClaim(row, now)) deps.enqueue(row.id);
  }
}
