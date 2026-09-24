import { describe, expect, it } from "vitest";
import { APICallError } from "@ai-sdk/provider";
import {
  attributionFromState,
  driverAttribution,
  failureFromError,
} from "../../src/engine/attribution.ts";
import {
  MAX_REPAIRS,
  REPAIR_TOKEN_BUDGET,
  RUN_TOKEN_BUDGET,
} from "../../src/engine/budgets.ts";
import type { BuildState } from "../../src/engine/schemas.ts";
import {
  isFinalizable,
  shouldStopBuilding,
} from "../../src/engine/stop-rules.ts";
import { ZERO_USAGE } from "../../src/engine/usage.ts";
import { CassetteMissError } from "../../src/models/cassette.ts";
import { MOCK_SPEC } from "../../src/models/mock.ts";
import type { Finding, Verdict } from "../../src/eval/e1/score.ts";

const finding = (ruleId: string): Finding => ({
  ruleId,
  severity: "hard",
  message: `${ruleId} failed`,
  fix: "fix it",
  citation: "cards/bridge.md:1",
});
const failing: Verdict = {
  ok: false,
  score: 0.5,
  errors: [finding("E1-13"), finding("E1-15")],
  warnings: [],
};
const passing: Verdict = { ok: true, score: 1, errors: [], warnings: [] };

function state(overrides: Partial<BuildState> = {}): BuildState {
  return {
    runKey: "kite-rush",
    prompt: "a kite game",
    spec: MOCK_SPEC,
    langSource: "detector",
    planUsage: ZERO_USAGE,
    buildAttempt: 1,
    repairs: 0,
    artifact: null,
    verdict: null,
    failure: null,
    runTokens: 0,
    repairTokens: 0,
    history: [],
    ...overrides,
  };
}

function apiError(isRetryable: boolean): APICallError {
  return new APICallError({
    message: "Overloaded",
    url: "https://example.invalid/v1/messages",
    requestBodyValues: {},
    statusCode: 529,
    isRetryable,
  });
}

describe("failureFromError (§4.5)", () => {
  it("copies retryable and the status code from APICallError", () => {
    expect(failureFromError("generate", apiError(true))).toMatchObject({
      step: "generate",
      code: "model-error",
      retryable: true,
      message: expect.stringContaining("529") as string,
    });
    expect(failureFromError("plan", apiError(false)).retryable).toBe(false);
  });

  it("finds a CassetteMissError by instanceof, also through a cause chain", () => {
    const miss = new CassetteMissError("no cassette");
    expect(failureFromError("plan", miss).code).toBe("cassette-miss");
    const wrapped = new Error("provider failed", { cause: miss });
    expect(failureFromError("generate", wrapped)).toMatchObject({
      code: "cassette-miss",
      retryable: false,
    });
  });

  it("treats anything else as a non-retryable model error", () => {
    expect(failureFromError("generate", new Error("strange"))).toMatchObject({
      code: "model-error",
      retryable: false,
    });
    expect(failureFromError("plan", "a string").message).toContain("a string");
  });
});

describe("attributionFromState (§4.5)", () => {
  it("uses the recorded step failure first", () => {
    const failure = {
      step: "verify-static",
      code: "verifier-crashed",
      message: "boom",
      retryable: false,
    } as const;
    expect(attributionFromState(state({ failure }))).toEqual({
      step: "verify-static",
      code: "verifier-crashed",
      buildAttempt: 1,
      ruleIds: [],
      message: "boom",
      retryable: false,
    });
  });

  it("blames generate for an unmet contract with the remaining hard rules", () => {
    const attribution = attributionFromState(
      state({ verdict: failing, repairs: MAX_REPAIRS }),
    );
    expect(attribution).toMatchObject({
      step: "generate",
      code: "contract-unmet",
      ruleIds: ["E1-13", "E1-15"],
    });
  });

  it("reports a spent budget as budget-exhausted", () => {
    expect(
      attributionFromState(
        state({ verdict: failing, runTokens: RUN_TOKEN_BUDGET }),
      ).code,
    ).toBe("budget-exhausted");
    expect(
      attributionFromState(
        state({ verdict: failing, repairTokens: REPAIR_TOKEN_BUDGET }),
      ).code,
    ).toBe("budget-exhausted");
  });

  it("builds driver attributions", () => {
    expect(driverAttribution("stream-cut", "closed early", 2)).toEqual({
      step: "driver",
      code: "stream-cut",
      buildAttempt: 2,
      ruleIds: [],
      message: "closed early",
      retryable: true,
    });
    expect(driverAttribution("engine-crashed", "bug").retryable).toBe(false);
  });
});

describe("stop rules (§4.1)", () => {
  it("stops on a failure, a pass, the repair cap or a budget", () => {
    expect(shouldStopBuilding(state({ verdict: failing }))).toBe(false);
    expect(shouldStopBuilding(state({ verdict: passing }))).toBe(true);
    expect(
      shouldStopBuilding(state({ verdict: failing, repairs: MAX_REPAIRS })),
    ).toBe(true);
    expect(
      shouldStopBuilding(
        state({ verdict: failing, repairTokens: REPAIR_TOKEN_BUDGET }),
      ),
    ).toBe(true);
    expect(
      shouldStopBuilding(
        state({ verdict: failing, runTokens: RUN_TOKEN_BUDGET }),
      ),
    ).toBe(true);
    const failure = {
      step: "plan",
      code: "plan-invalid-spec",
      message: "x",
      retryable: false,
    } as const;
    expect(shouldStopBuilding(state({ failure }))).toBe(true);
  });

  it("finalizes only a passing verdict with no failure", () => {
    expect(isFinalizable(state({ verdict: passing }))).toBe(true);
    expect(isFinalizable(state({ verdict: failing }))).toBe(false);
    const failure = {
      step: "generate",
      code: "generate-truncated",
      message: "x",
      retryable: false,
    } as const;
    expect(isFinalizable(state({ verdict: passing, failure }))).toBe(false);
  });
});
