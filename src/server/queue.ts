/** Drivers the dev server runs at once. Arbitrary cap. */
export const DRIVER_CONCURRENCY = 2;

export interface DriverQueue {
  enqueue(runId: string): void;
  /** Resolves once nothing is queued or running. */
  idle(): Promise<void>;
}

/**
 * An in-process queue that runs drivers with bounded concurrency (§5.4). A driver that throws is
 * dropped; its row stays as the store left it.
 * @param concurrency drivers allowed at once
 * @param drive drives one run
 */
export function createDriverQueue(
  concurrency: number,
  drive: (runId: string) => Promise<unknown>,
): DriverQueue {
  const waiting: string[] = [];
  const idleWaiters: (() => void)[] = [];
  let running = 0;

  const settleIdle = () => {
    if (running > 0 || waiting.length > 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const pump = () => {
    while (running < concurrency && waiting.length > 0) {
      const runId = waiting.shift();
      if (runId === undefined) break;
      running += 1;
      void drive(runId)
        .catch(() => undefined)
        .finally(() => {
          running -= 1;
          pump();
          settleIdle();
        });
    }
  };

  return {
    enqueue: (runId) => {
      waiting.push(runId);
      pump();
    },
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        settleIdle();
      }),
  };
}
