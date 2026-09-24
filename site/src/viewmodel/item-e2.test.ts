import { describe, expect, it } from "vitest";
import { reportItem } from "../data/report";
import { distinctErrors, itemE2View } from "./item-e2";

describe("item E2 view", () => {
  it("shows every detector in SPEC order with the committed verdicts", () => {
    const view = itemE2View(reportItem("maze-de-haies"));
    expect(view?.passed).toBe(false);
    expect(
      view?.detectors.map((row) => `${row.detector}:${row.verdict}`),
    ).toEqual([
      "boot-handshake:pass",
      "blank-frame:pass",
      "idle-static:n/a",
      "tap-unresponsive:fail",
      "idle-death:pass",
      "console-error:fail",
    ]);
  });

  it("collapses repeated console errors", () => {
    const view = itemE2View(reportItem("maze-de-haies"));
    expect(view?.consoleErrors).toHaveLength(1);
    expect(view?.consoleErrors[0]?.message).toBe(
      "error: Uncaught TypeError: pick is not iterable",
    );
    expect(view?.consoleErrors[0]?.count).toBeGreaterThan(1);
    expect(distinctErrors(["a", "b", "a"])).toEqual([
      { message: "a", count: 2 },
      { message: "b", count: 1 },
    ]);
  });

  it("passes a game whose detectors all pass or do not apply", () => {
    expect(itemE2View(reportItem("bubble-pop"))?.passed).toBe(true);
  });
});
