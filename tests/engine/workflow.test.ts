import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError } from "@ai-sdk/provider";
import { MemoryArtifactStore } from "../../src/engine/artifacts/memory.ts";
import { MAX_REPAIRS, RUN_TOKEN_BUDGET } from "../../src/engine/budgets.ts";
import { createModel } from "../../src/models/port.ts";
import {
  MOCK_GAME_HTML,
  MOCK_SPEC,
  scriptedTurns,
} from "../../src/models/mock.ts";
import {
  BROKEN_GAME_HTML,
  doneTurn,
  kinds,
  planTurn,
  runWorkflow,
  saveTurn,
} from "./workflow-helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function overloaded(isRetryable: boolean): APICallError {
  return new APICallError({
    message: "Overloaded",
    url: "https://example.invalid/v1/messages",
    requestBodyValues: {},
    statusCode: 529,
    isRetryable,
  });
}

describe("workflow graph end to end with a mock model (§4.1)", () => {
  it("runs plan → build-cycle → finalize and returns the saved artifact", async () => {
    const run = await runWorkflow({});
    expect(run.status).toBe("success");
    const finalize = run.output?.finalize;
    expect(finalize?.outcome).toBe("passed");
    expect(finalize?.html).toBe(MOCK_GAME_HTML);
    expect(finalize?.artifact.version).toBe("a0");
    expect(finalize?.history).toHaveLength(1);
    expect(finalize?.history[0]).toMatchObject({
      mode: "initial",
      repairOf: [],
      finishReason: "stop",
    });
    expect(kinds(run.events)).toEqual([
      "step.start",
      "usage",
      "plan.spec",
      "step.result",
      "step.start",
      "phase.start",
      "tool.call",
      "usage",
      "phase.start",
      "verify.verdict",
      "step.result",
      "step.start",
      "step.result",
    ]);
    expect(run.chunkTypes.at(-1)).toBe("workflow-finish");
    const steps = run.events
      .filter((event) => event.kind === "step.start")
      .map((event) => event.data);
    expect(steps).toEqual([
      { step: "plan" },
      { step: "build-cycle" },
      { step: "finalize" },
    ]);
  });

  it("repairs a broken first draft and records which rules caused the repair", async () => {
    const builder = scriptedTurns([
      saveTurn(BROKEN_GAME_HTML),
      doneTurn,
      saveTurn(MOCK_GAME_HTML),
      doneTurn,
    ]);
    const run = await runWorkflow({ builder });
    const finalize = run.output?.finalize;
    expect(finalize?.history).toHaveLength(2);
    expect(finalize?.history[0]?.verdict?.ok).toBe(false);
    expect(finalize?.history[1]).toMatchObject({
      mode: "repair",
      buildAttempt: 1,
      repairOf: ["E1-13"],
    });
    expect(finalize?.artifact.version).toBe("a1");
    const repairStart = run.events.find(
      (event) => event.kind === "repair.start",
    );
    expect(repairStart?.data).toEqual({
      buildAttempt: 1,
      fromRules: ["E1-13"],
    });
    const repairPrompt = JSON.stringify(builder.doStreamCalls[2]?.prompt);
    expect(repairPrompt).toContain("E1-13");
    expect(repairPrompt).toContain("load_draft");
  });

  it("keeps the planner's language when the detector cannot decide", async () => {
    const run = await runWorkflow({
      plannerTurns: [planTurn({ ...MOCK_SPEC, lang: "fr" })],
      input: { prompt: "neon frog" },
    });
    const plan = run.events.find((event) => event.kind === "plan.spec");
    expect(plan?.data).toMatchObject({
      langSource: "planner",
      spec: { lang: "fr" },
    });
  });

  it("overrides the planner's language with the detector's", async () => {
    const run = await runWorkflow({
      plannerTurns: [planTurn({ ...MOCK_SPEC, lang: "fr" })],
    });
    const plan = run.events.find((event) => event.kind === "plan.spec");
    expect(plan?.data).toMatchObject({
      langSource: "detector",
      spec: { lang: "en" },
    });
  });

  it("keeps two cartridges with different stores isolated when run in parallel", async () => {
    const left = new MemoryArtifactStore();
    const right = new MemoryArtifactStore();
    const [first, second] = await Promise.all([
      runWorkflow({ artifacts: left, input: { runKey: "left-run" } }),
      runWorkflow({ artifacts: right, input: { runKey: "right-run" } }),
    ]);
    expect(first.output?.finalize).toBeDefined();
    expect(second.output?.finalize).toBeDefined();
    expect(await left.latest("right-run")).toBeNull();
    expect(await right.latest("left-run")).toBeNull();
    expect((await left.latest("left-run"))?.html).toBe(MOCK_GAME_HTML);
  });
});

describe("every failure code is attributed (§4.5)", () => {
  async function rejected(options: Parameters<typeof runWorkflow>[0]) {
    const run = await runWorkflow(options);
    expect(run.status).toBe("success");
    const reject = run.output?.reject;
    if (!reject) throw new Error("expected a reject output");
    return reject;
  }

  it("plan-invalid-spec when the structured output fails GameSpec", async () => {
    const reject = await rejected({
      plannerTurns: [{ kind: "text", text: "not a plan" }],
    });
    expect(reject.attribution).toMatchObject({
      step: "plan",
      code: "plan-invalid-spec",
    });
    expect(reject.history).toEqual([]);
  });

  it("plan-invalid-spec when the planner stops on length", async () => {
    const reject = await rejected({
      plannerTurns: [
        {
          kind: "text",
          text: JSON.stringify(MOCK_SPEC),
          finishReason: "length",
        },
      ],
    });
    expect(reject.attribution).toMatchObject({
      step: "plan",
      code: "plan-invalid-spec",
    });
  });

  it("model-refusal when the planner's call ends with content-filter", async () => {
    const reject = await rejected({
      plannerTurns: [
        { kind: "text", text: "no", finishReason: "content-filter" },
      ],
    });
    expect(reject.attribution).toMatchObject({
      step: "plan",
      code: "model-refusal",
      retryable: false,
    });
  });

  it("model-refusal when the builder's call ends with content-filter", async () => {
    const reject = await rejected({
      builderTurns: [
        { kind: "text", text: "no", finishReason: "content-filter" },
      ],
    });
    expect(reject.attribution).toMatchObject({
      step: "generate",
      code: "model-refusal",
    });
  });

  it("generate-no-artifact when the builder saves nothing", async () => {
    const reject = await rejected({ builderTurns: [doneTurn] });
    expect(reject.attribution).toMatchObject({
      step: "generate",
      code: "generate-no-artifact",
      buildAttempt: 0,
    });
    expect(reject.history[0]?.artifact).toBeNull();
  });

  it("generate-no-artifact even when an earlier run of the same run key left a draft", async () => {
    const artifacts = new MemoryArtifactStore();
    await artifacts.put("lantern-dash", 0, MOCK_GAME_HTML);
    const reject = await rejected({ artifacts, builderTurns: [doneTurn] });
    expect(reject.attribution).toMatchObject({
      step: "generate",
      code: "generate-no-artifact",
    });
  });

  it("load_draft does not show the builder a draft from an earlier run", async () => {
    const artifacts = new MemoryArtifactStore();
    await artifacts.put("lantern-dash", 0, "<p>earlier-run-draft</p>");
    const builder = scriptedTurns([
      { kind: "tool", tool: "load_draft", input: {} },
      saveTurn(MOCK_GAME_HTML),
      doneTurn,
    ]);
    const run = await runWorkflow({ artifacts, builder });
    expect(run.output?.finalize).toBeDefined();
    const seen = JSON.stringify(builder.doStreamCalls[1]?.prompt);
    expect(seen).toContain("load_draft");
    expect(seen).not.toContain("earlier-run-draft");
  });

  it("generate-truncated when the builder's final turn stops on length mid tool call", async () => {
    const reject = await rejected({
      builderTurns: [
        { kind: "cut-tool", tool: "save_draft", partial: '{"html":"<!doctype' },
      ],
    });
    expect(reject.attribution).toMatchObject({
      step: "generate",
      code: "generate-truncated",
    });
    expect(reject.history[0]?.finishReason).toBe("length");
  });

  it("contract-unmet, blamed on generate, after MAX_REPAIRS repairs", async () => {
    const builderTurns = Array.from({ length: MAX_REPAIRS + 1 }, () => [
      saveTurn(BROKEN_GAME_HTML),
      doneTurn,
    ]).flat();
    const reject = await rejected({ builderTurns });
    expect(reject.attribution).toMatchObject({
      step: "generate",
      code: "contract-unmet",
      ruleIds: ["E1-13"],
      buildAttempt: MAX_REPAIRS,
    });
    expect(reject.history).toHaveLength(MAX_REPAIRS + 1);
  });

  it("budget-exhausted when a token budget is spent before ok", async () => {
    const reject = await rejected({
      builderTurns: [
        saveTurn(BROKEN_GAME_HTML, { input: RUN_TOKEN_BUDGET, output: 1 }),
        doneTurn,
      ],
    });
    expect(reject.attribution).toMatchObject({
      step: "generate",
      code: "budget-exhausted",
    });
    expect(reject.history).toHaveLength(1);
  });

  it("stops the builder mid-pass at the first step that spends the budget", async () => {
    const reject = await rejected({
      builderTurns: [
        saveTurn(BROKEN_GAME_HTML, { input: RUN_TOKEN_BUDGET, output: 1 }),
        saveTurn(BROKEN_GAME_HTML, { input: 7, output: 1 }),
        doneTurn,
      ],
    });
    expect(reject.attribution).toMatchObject({ code: "budget-exhausted" });
    expect(reject.history[0]?.usage).toMatchObject({
      input: RUN_TOKEN_BUDGET,
      output: 1,
    });
  });

  it("verifier-crashed when E1 throws", async () => {
    const reject = await rejected({
      verify: () => {
        throw new Error("scorer bug");
      },
    });
    expect(reject.attribution).toMatchObject({
      step: "verify-static",
      code: "verifier-crashed",
    });
    expect(reject.attribution.message).toContain("scorer bug");
  });

  it("model-error with retryable copied from APICallError.isRetryable", async () => {
    const retryable = await rejected({
      builderTurns: [{ kind: "error", error: overloaded(true) }],
    });
    expect(retryable.attribution).toMatchObject({
      step: "generate",
      code: "model-error",
      retryable: true,
    });
    expect(retryable.attribution.message).toContain("529");
    const fatal = await rejected({
      plannerTurns: [{ kind: "error", error: overloaded(false) }],
    });
    expect(fatal.attribution).toMatchObject({
      step: "plan",
      code: "model-error",
      retryable: false,
    });
  });

  it("cassette-miss when replay has no recording", async () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-cassettes-"));
    dirs.push(dir);
    const reject = await rejected({
      planner: createModel("planner", "replay", { cassetteDir: dir, env: {} }),
    });
    expect(reject.attribution).toMatchObject({
      step: "plan",
      code: "cassette-miss",
      retryable: false,
    });
  });
});
