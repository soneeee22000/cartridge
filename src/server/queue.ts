/** Drivers the dev server runs at once. Arbitrary cap. */
export const DRIVER_CONCURRENCY = 2;

export interface DriverQueue {
  /** Queues a run unless it is already queued or running. */
  enqueue(runId: string): void;
  /** Resolves once nothing is queued or running. */
  idle(): Promise<void>;
}

interface QueueState {
  readonly waiting: string[];
  readonly known: Set<string>;
  readonly idleWaiters: (() => void)[];
  running: number;
}

function settleIdle(state: QueueState): void {
  if (state.running > 0 || state.waiting.length > 0) return;
  for (const resolve of state.idleWaiters.splice(0)) resolve();
}

/**
 * An in-process queue that runs drivers with bounded concurrency (§5.4). A run id is held at most
 * once, queued or running. A driver that throws is dropped and its row stays as the store left it;
 * a driver whose result `requeue` accepts (a released run) is queued again.
 * @param concurrency drivers allowed at once
 * @param drive drives one run
 * @param requeue true when a finished drive should run again
 */
export function createDriverQueue<T>(
  concurrency: number,
  drive: (runId: string) => Promise<T>,
  requeue: (result: T) => boolean = () => false,
): DriverQueue {
  const state: QueueState = {
    waiting: [],
    known: new Set(),
    idleWaiters: [],
    running: 0,
  };
  const enqueue = (runId: string): void => {
    if (state.known.has(runId)) return;
    state.known.add(runId);
    state.waiting.push(runId);
    pump();
  };
  const finish = (runId: string, again: boolean): void => {
    state.running -= 1;
    state.known.delete(runId);
    if (again) enqueue(runId);
    pump();
    settleIdle(state);
  };
  const pump = (): void => {
    while (state.running < concurrency) {
      const runId = state.waiting.shift();
      if (runId === undefined) return;
      state.running += 1;
      void drive(runId).then(
        (result) => {
          finish(runId, requeue(result));
        },
        () => {
          finish(runId, false);
        },
      );
    }
  };
  return {
    enqueue,
    idle: () =>
      new Promise<void>((resolve) => {
        state.idleWaiters.push(resolve);
        settleIdle(state);
      }),
  };
}
