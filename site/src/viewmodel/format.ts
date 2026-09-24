const SCORE_DECIMALS = 3;
const USD_DECIMALS = 2;
const SECONDS_DECIMALS = 1;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Format an E1 score the way the report does, e.g. `1.000`. */
export function formatScore(score: number): string {
  if (!Number.isFinite(score) || score < 0 || score > 1)
    throw new RangeError(`Expected a score in [0, 1], got ${String(score)}`);
  return score.toFixed(SCORE_DECIMALS);
}

/** Format a count against its denominator, e.g. `11/20`. */
export function formatCount(count: number, total: number): string {
  return `${String(count)}/${String(total)}`;
}

/** Format a USD estimate with two decimals, e.g. `$3.15`. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(USD_DECIMALS)}`;
}

/** Format milliseconds as seconds with one decimal, e.g. `62.1 s`. */
export function formatSeconds(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(SECONDS_DECIMALS)} s`;
}

/** Format milliseconds as whole minutes and seconds, e.g. `22 min 21 s`. */
export function formatMinutes(ms: number): string {
  const totalSeconds = Math.round(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${String(minutes)} min ${String(seconds)} s`;
}

/** Format a token count with thousands separators, e.g. `614,025`. */
export function formatTokens(count: number): string {
  return count.toLocaleString("en-GB");
}
