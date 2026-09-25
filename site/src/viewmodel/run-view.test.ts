import { describe, expect, it } from "vitest";
import { reportItem } from "../data/report";
import bubblePop from "../data/transcripts/bubble-pop.sse?raw";
import { INITIAL_REPLAY_STATE, reduceReplay } from "./replay-state";
import { parseSseTranscript } from "./sse";
import {
  elapsedSeconds,
  frameTitle,
  paceNote,
  statusText,
  terminalScore,
  verdictLine,
} from "./run-view";

describe("run view helpers", () => {
  it("describes verdicts", () => {
    expect(
      verdictLine({
        buildAttempt: 0,
        ok: false,
        score: 0.952,
        errors: ["E1-24"],
      }),
    ).toBe("Attempt 0: E1 0.952, failed E1-24");
    expect(
      verdictLine({ buildAttempt: 1, ok: true, score: 1, errors: [] }),
    ).toBe("Attempt 1: E1 1.000, passed");
  });

  it("quotes the item's recorded wall time from full.json", () => {
    expect(paceNote(reportItem("bubble-pop"))).toContain("80.9 s");
    expect(paceNote(reportItem("bubble-pop"))).toContain("1.5 s");
    expect(paceNote(reportItem("bubble-pop"))).toContain("divides every gap by 8");
    expect(paceNote(null)).toContain("not recorded");
  });

  it("shows the status and the error", () => {
    const failed = reduceReplay(INITIAL_REPLAY_STATE, {
      type: "failed",
      message: "Server said no.",
    });
    expect(statusText(failed)).toBe(
      "The replay could not run. Server said no.",
    );
    expect(statusText(INITIAL_REPLAY_STATE)).toBe(
      "Pick a prompt and start the replay.",
    );
  });

  it("announces the score and build attempts when a run completes", () => {
    const done = parseSseTranscript(bubblePop).reduce(
      (state, message) =>
        reduceReplay(
          state,
          message.event === "terminal"
            ? { type: "terminal", seq: message.id ?? 0, data: message.data }
            : { type: "progress", seq: message.id ?? 0, data: message.data },
        ),
      reduceReplay(INITIAL_REPLAY_STATE, {
        type: "start",
        promptId: "bubble-pop",
      }),
    );
    expect(statusText(done)).toBe(
      "Run complete: E1 1.000 after 2 build attempts. The game is below.",
    );
  });

  it("reads the terminal score only once it arrives", () => {
    expect(terminalScore(INITIAL_REPLAY_STATE)).toBeNull();
    const done = reduceReplay(INITIAL_REPLAY_STATE, {
      type: "terminal",
      seq: 3,
      data: JSON.stringify({ status: "complete", e1Score: 1 }),
    });
    expect(terminalScore(done)).toBe("1.000");
  });

  it("counts whole elapsed seconds and names the frame", () => {
    expect(elapsedSeconds(1000, 3999)).toBe(2);
    expect(elapsedSeconds(5000, 1000)).toBe(0);
    const started = reduceReplay(INITIAL_REPLAY_STATE, {
      type: "start",
      promptId: "bubble-pop",
    });
    expect(frameTitle(started)).toBe("Game generated for bubble-pop");
  });
});
