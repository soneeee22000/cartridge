import { describe, expect, it } from "vitest";
import {
  SEAL_LEASE_MS,
  STALE_ACTIVE_MS,
  canClaim,
  canReap,
  type LeaseFields,
} from "../../src/engine/lifecycle.ts";

const NOW = 1_000_000;

function row(fields: Partial<LeaseFields>): LeaseFields {
  return {
    status: "active",
    claims: 1,
    maxClaims: 1,
    heartbeatAt: NOW,
    sealUntil: null,
    ...fields,
  };
}

describe("lifecycle guards (§5.1)", () => {
  it("reaps a stale active row that has no claims left", () => {
    const stale = row({ heartbeatAt: NOW - STALE_ACTIVE_MS - 1 });
    expect(canReap(stale, NOW)).toBe(true);
    expect(canClaim(stale, NOW)).toBe(false);
  });

  it("reaps an expired sealing row that has no claims left", () => {
    const expired = row({ status: "sealing", sealUntil: NOW - 1 });
    expect(canReap(expired, NOW)).toBe(true);
    expect(
      canReap(row({ status: "sealing", sealUntil: NOW + SEAL_LEASE_MS }), NOW),
    ).toBe(false);
  });

  it("never reaps a live row, a row with claims left or a terminal row", () => {
    expect(canReap(row({}), NOW)).toBe(false);
    const stale = NOW - STALE_ACTIVE_MS - 1;
    expect(canReap(row({ maxClaims: 2, heartbeatAt: stale }), NOW)).toBe(
      false,
    );
    expect(canReap(row({ status: "waiting", heartbeatAt: stale }), NOW)).toBe(
      false,
    );
    expect(canReap(row({ status: "complete", heartbeatAt: stale }), NOW)).toBe(
      false,
    );
  });
});
