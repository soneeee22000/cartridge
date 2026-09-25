import { describe, expect, it } from "vitest";
import { MAX_SILENT_ERRORS, errorOutcome, replayUrl } from "./replay-source";

describe("replay connection", () => {
  it("puts the prompt id and pace in the URL", () => {
    expect(replayUrl("bubble-pop", "fast")).toBe(
      "/api/replay?promptId=bubble-pop&pace=fast",
    );
  });

  it("gives up with an unreachable message when no event ever arrived", () => {
    expect(errorOutcome({ closed: false, received: 0, silentErrors: 1 })).toBe(
      "retry",
    );
    expect(
      errorOutcome({
        closed: false,
        received: 0,
        silentErrors: MAX_SILENT_ERRORS,
      }),
    ).toBe("unreachable");
  });

  it("gives up after repeated errors with no message in between, even mid-run", () => {
    expect(errorOutcome({ closed: false, received: 5, silentErrors: 1 })).toBe(
      "retry",
    );
    expect(
      errorOutcome({
        closed: false,
        received: 5,
        silentErrors: MAX_SILENT_ERRORS,
      }),
    ).toBe("lost");
  });

  it("treats a closed source as refused", () => {
    expect(errorOutcome({ closed: true, received: 0, silentErrors: 1 })).toBe(
      "refused",
    );
  });
});
