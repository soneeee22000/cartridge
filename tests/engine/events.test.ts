import { describe, expect, it } from "vitest";
import {
  ProgressEvent,
  TerminalEvent,
  mapWorkflowChunk,
} from "../../src/engine/events.ts";

describe("mapWorkflowChunk (§6.1)", () => {
  it("maps top-level step start and result chunks", () => {
    expect(
      mapWorkflowChunk({
        type: "workflow-step-start",
        payload: { id: "plan", status: "running" },
      }),
    ).toEqual([{ kind: "step.start", data: { step: "plan" } }]);
    expect(
      mapWorkflowChunk({
        type: "workflow-step-result",
        payload: { id: "build-cycle", status: "success" },
      }),
    ).toEqual([
      { kind: "step.result", data: { step: "build-cycle", status: "success" } },
    ]);
  });

  it("passes data-cartridge chunks through after validation", () => {
    const data = {
      kind: "phase.start",
      data: { phase: "generate", buildAttempt: 0 },
    };
    expect(mapWorkflowChunk({ type: "data-cartridge", data })).toEqual([data]);
  });

  it("rejects a dotted (nested) step id", () => {
    expect(() =>
      mapWorkflowChunk({
        type: "workflow-step-start",
        payload: { id: "build-cycle.generate" },
      }),
    ).toThrow(/nested step id/);
  });

  it("rejects a malformed data-cartridge chunk and a driver-only kind", () => {
    expect(() =>
      mapWorkflowChunk({
        type: "data-cartridge",
        data: { kind: "phase.start" },
      }),
    ).toThrow();
    expect(() =>
      mapWorkflowChunk({
        type: "data-cartridge",
        data: { kind: "run.claimed", data: { claimAttempt: 1 } },
      }),
    ).toThrow();
  });

  it("ignores every other chunk", () => {
    expect(mapWorkflowChunk({ type: "workflow-start", payload: {} })).toEqual(
      [],
    );
    expect(mapWorkflowChunk({ type: "workflow-finish", payload: {} })).toEqual(
      [],
    );
    expect(mapWorkflowChunk("noise")).toEqual([]);
  });
});

describe("event schemas", () => {
  it("accepts every progress kind", () => {
    const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
    const events = [
      { kind: "run.claimed", data: { claimAttempt: 1 } },
      { kind: "tool.call", data: { phase: "generate", tool: "save_draft" } },
      {
        kind: "verify.verdict",
        data: { buildAttempt: 0, ok: false, score: 0.5, errors: ["E1-13"] },
      },
      { kind: "repair.start", data: { buildAttempt: 1, fromRules: ["E1-13"] } },
      { kind: "usage", data: { phase: "plan", buildAttempt: 0, usage } },
    ];
    for (const event of events)
      expect(ProgressEvent.parse(event)).toEqual(event);
  });

  it("builds terminal events with only row fields", () => {
    expect(TerminalEvent.parse({ status: "complete", e1Score: 1 })).toEqual({
      status: "complete",
      e1Score: 1,
    });
    expect(() => TerminalEvent.parse({ status: "active" })).toThrow();
  });
});
