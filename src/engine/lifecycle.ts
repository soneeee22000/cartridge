import { z } from "zod";
import type { Attribution } from "./schemas.ts";

/** Run table vocabulary (§5.1). */
export const RUN_STATUSES = [
  "waiting",
  "active",
  "sealing",
  "complete",
  "abandoned",
] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;

/** Claims per run for demo and dev runs. Arbitrary cap, not tuned. */
export const MAX_CLAIMS = 2;
/** Claims per run for eval runs, so each item's cost belongs to one generation. */
export const MAX_CLAIMS_EVAL = 1;
/** How often the driver renews its claim. Arbitrary, not tuned. */
export const HEARTBEAT_INTERVAL_MS = 20_000;
/** An active row with no heartbeat for this long can be reclaimed. Arbitrary, not tuned. */
export const STALE_ACTIVE_MS = 75_000;
/** How long a seal lease lasts. Arbitrary, not tuned. */
export const SEAL_LEASE_MS = 30_000;

/** The fields every transition guard reads. */
export interface LeaseFields {
  readonly status: RunStatus;
  readonly claims: number;
  readonly maxClaims: number;
  readonly heartbeatAt: number | null;
  readonly sealUntil: number | null;
}

/**
 * `complete` and `abandoned` never change again.
 * @param status row status
 */
export function isTerminal(status: RunStatus): boolean {
  return status === "complete" || status === "abandoned";
}

/**
 * The claim guard (§5.2 invariant 1), the same predicate as the SQL `WHERE` clause.
 * @param row current lease fields
 * @param now current time in milliseconds
 */
export function canClaim(row: LeaseFields, now: number): boolean {
  if (row.claims >= row.maxClaims) return false;
  return row.status === "waiting" || leaseExpired(row, now);
}

function leaseExpired(row: LeaseFields, now: number): boolean {
  if (row.status === "active")
    return (row.heartbeatAt ?? 0) < now - STALE_ACTIVE_MS;
  if (row.status === "sealing") return (row.sealUntil ?? 0) < now;
  return false;
}

/**
 * The reaper guard (§5.1): a stale `active` row or an expired `sealing` row whose claims are used
 * up can never be claimed again, so it is abandoned instead of staying open for good. The same
 * predicate as the SQL `WHERE` clause.
 * @param row current lease fields
 * @param now current time in milliseconds
 */
export function canReap(row: LeaseFields, now: number): boolean {
  return row.claims >= row.maxClaims && leaseExpired(row, now);
}

/**
 * Decides what a failed claim does next (§5.2 invariant 4): only a retryable failure with claims
 * left goes back to `waiting`; everything else is abandoned.
 * @param attribution why the claim ended
 * @param row claims used and allowed
 */
export function settlement(
  attribution: Attribution,
  row: Pick<LeaseFields, "claims" | "maxClaims">,
): "release" | "abandon" {
  return attribution.retryable && row.claims < row.maxClaims
    ? "release"
    : "abandon";
}
