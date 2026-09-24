import { describe, expect, it } from "vitest";
import bubblePop from "../data/transcripts/bubble-pop.sse?raw";
import tileSort from "../data/transcripts/tile-sort.sse?raw";
import {
  INITIAL_REPLAY_STATE,
  type ReplayAction,
  type ReplayState,
  isRunning,
  reduceReplay,
} from "./replay-state";
import { parseSseTranscript } from "./sse";

/** Turn a recorded SSE body into the actions the page dispatches for it. */
function actionsFor(transcript: string): ReplayAction[] {
  return parseSseTranscript(transcript).map((message) => {
    const seq = message.id ?? 0;
    if (message.event === "terminal")
      return { type: "terminal", seq, data: message.data };
    return { type: "progress", seq, data: message.data };
  });
}

/** Replay a transcript through the reducer from a fresh start. */
function replay(promptId: string, transcript: string): ReplayState {
  return actionsFor(transcript).reduce(
    reduceReplay,
    reduceReplay(INITIAL_REPLAY_STATE, { type: "start", promptId }),
  );
}

describe("replay reducer on the recorded bubble-pop transcript (one repair)", () => {
  const state = replay("bubble-pop", bubblePop);

  it("ends complete with the finalize node done and reject untouched", () => {
    expect(state.phase).toBe("complete");
    expect(state.nodes).toEqual({
      plan: "done",
      generate: "done",
      verify: "done",
      repair: "done",
      finalize: "done",
      reject: "idle",
    });
    expect(isRunning(state)).toBe(false);
  });

  it("walks the repair loop edge before finalizing", () => {
    expect(state.edges).toEqual([
      "plan>generate",
      "generate>verify",
      "verify>repair",
      "repair>generate",
      "verify>finalize",
    ]);
    expect(state.repairs).toEqual([{ buildAttempt: 1, fromRules: ["E1-24"] }]);
  });

  it("keeps both E1 verdicts, the failing one first", () => {
    expect(state.verdicts.map((entry) => [entry.ok, entry.errors])).toEqual([
      [false, ["E1-24"]],
      [true, []],
    ]);
  });

  it("takes the E1 score and the game from the terminal event", () => {
    expect(state.terminal?.e1Score).toBe(1);
    expect(state.terminal?.artifact?.version).toBe("a1");
    expect(state.terminal?.artifact?.html.startsWith("<!doctype html>")).toBe(
      true,
    );
  });

  it("logs one line per event, in sequence order", () => {
    const seqs = state.log.map((entry) => entry.seq);
    expect(seqs).toEqual(seqs.toSorted((a, b) => (a ?? 0) - (b ?? 0)));
    expect(state.log).toHaveLength(parseSseTranscript(bubblePop).length);
    expect(
      state.log.find((entry) => entry.kind === "repair.start"),
    ).toMatchObject({ text: "repair from E1-24, attempt 1", tone: "trip" });
  });

  it("shows the plan spec", () => {
    expect(state.spec).toMatchObject({
      gameType: "toy-box",
      input: "tap-anywhere",
      lang: "en",
    });
  });
});

describe("replay reducer on the recorded tile-sort transcript (first pass)", () => {
  const state = replay("tile-sort", tileSort);

  it("never lights the repair node or its edges", () => {
    expect(state.nodes.repair).toBe("idle");
    expect(state.edges).not.toContain("verify>repair");
    expect(state.verdicts).toHaveLength(1);
    expect(state.phase).toBe("complete");
  });
});

describe("replay reducer mid-run and on errors", () => {
  const actions = actionsFor(bubblePop);

  it("shows the failing verify and the active repair node part way through", () => {
    const upToRepair = actions.findIndex(
      (action) =>
        action.type === "progress" && action.data.includes("repair.start"),
    );
    const state = actions.slice(0, upToRepair + 1).reduce(
      reduceReplay,
      reduceReplay(INITIAL_REPLAY_STATE, {
        type: "start",
        promptId: "bubble-pop",
      }),
    );
    expect(state.phase).toBe("streaming");
    expect(state.nodes.verify).toBe("failed");
    expect(state.nodes.repair).toBe("active");
    expect(isRunning(state)).toBe(true);
  });

  it("ignores a repeated or older sequence number after a reconnect", () => {
    const once = actions.slice(0, 5).reduce(reduceReplay, INITIAL_REPLAY_STATE);
    const again = actions.slice(0, 5).reduce(reduceReplay, once);
    expect(again.log).toHaveLength(once.log.length);
    expect(again.lastSeq).toBe(5);
  });

  it("records reconnects and failures without losing progress", () => {
    const partial = actions
      .slice(0, 5)
      .reduce(reduceReplay, INITIAL_REPLAY_STATE);
    const reconnecting = reduceReplay(partial, { type: "connection-lost" });
    expect(reconnecting.phase).toBe("reconnecting");
    expect(reconnecting.lastSeq).toBe(5);
    const failed = reduceReplay(reconnecting, {
      type: "failed",
      message: "replay unavailable",
    });
    expect(failed.phase).toBe("error");
    expect(failed.error).toBe("replay unavailable");
  });

  it("stops without losing what was received", () => {
    const partial = actions
      .slice(0, 5)
      .reduce(reduceReplay, INITIAL_REPLAY_STATE);
    const stopped = reduceReplay(partial, { type: "stopped" });
    expect(stopped.phase).toBe("stopped");
    expect(isRunning(stopped)).toBe(false);
    expect(stopped.lastSeq).toBe(5);
  });

  it("starts clean when a new prompt is picked", () => {
    const partial = actions
      .slice(0, 10)
      .reduce(reduceReplay, INITIAL_REPLAY_STATE);
    const restarted = reduceReplay(partial, {
      type: "start",
      promptId: "tile-sort",
    });
    expect(restarted).toEqual({
      ...INITIAL_REPLAY_STATE,
      promptId: "tile-sort",
      phase: "connecting",
    });
  });

  it("marks an abandoned run on the reject node with its attribution", () => {
    const state = reduceReplay(INITIAL_REPLAY_STATE, {
      type: "terminal",
      seq: 9,
      data: JSON.stringify({
        status: "abandoned",
        attribution: {
          step: "generate",
          code: "contract-unmet",
          attempt: 3,
          ruleIds: ["E1-24"],
        },
      }),
    });
    expect(state.phase).toBe("abandoned");
    expect(state.nodes.reject).toBe("failed");
    expect(state.terminal?.attribution).toBe("generate: contract-unmet");
    expect(state.terminal?.artifact).toBeNull();
  });

  it("logs a malformed event instead of throwing", () => {
    const state = reduceReplay(INITIAL_REPLAY_STATE, {
      type: "progress",
      seq: 1,
      data: "not json",
    });
    expect(state.log.at(-1)?.kind).toBe("unrecognised");
  });
});

describe("replay reducer connection notes", () => {
  it("adds one note when a reconnect request is followed by the drop it causes", () => {
    const asked = reduceReplay(INITIAL_REPLAY_STATE, { type: "reconnect" });
    const dropped = reduceReplay(asked, { type: "connection-lost" });
    expect(dropped.log).toHaveLength(1);
    expect(dropped.phase).toBe("reconnecting");
  });
});
