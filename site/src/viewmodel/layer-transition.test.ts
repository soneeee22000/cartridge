import { describe, expect, it } from "vitest";
import { transitionFor } from "./layers";

describe("layer transitions", () => {
  it("explodes bottom-first when leaving the collapsed state", () => {
    expect(transitionFor("collapsed", "1")).toBe("explode");
    expect(transitionFor("collapsed", "overview")).toBe("explode");
  });

  it("collapses top-first when returning to the collapsed state", () => {
    expect(transitionFor("3", "collapsed")).toBe("collapse");
  });

  it("only shifts lift and opacity between exploded states", () => {
    expect(transitionFor("2", "3")).toBe("shift");
    expect(transitionFor("5", "overview")).toBe("shift");
  });

  it("does nothing when the state is unchanged", () => {
    expect(transitionFor("collapsed", "collapsed")).toBe("none");
    expect(transitionFor("4", "4")).toBe("none");
  });
});
