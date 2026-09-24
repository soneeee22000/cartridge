/** Time source injected everywhere a transition or a timeout reads the time, so tests never sleep. */
export interface Clock {
  now(): number;
}

/** Waits for the given number of milliseconds. */
export type Sleep = (ms: number) => Promise<void>;

/** The wall clock. */
export const systemClock: Clock = { now: () => Date.now() };

/**
 * Resolves after `ms` milliseconds.
 * @param ms delay in milliseconds
 */
export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A clock tests can move by hand. */
export interface ManualClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

/**
 * Builds a clock that only moves when told to.
 * @param start initial time in milliseconds
 */
export function manualClock(start = 0): ManualClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (ms) => {
      current = ms;
    },
  };
}
