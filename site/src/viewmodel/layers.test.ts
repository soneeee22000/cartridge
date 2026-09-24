import { describe, expect, it } from "vitest";
import {
  LAYER_STEPS,
  activePlaneIndex,
  parseLayerStep,
  stepForScrollProgress,
  stepOffset,
  stepStatus,
} from "./layers";

describe("layer steps", () => {
  it("runs collapsed, five planes, then overview", () => {
    expect(LAYER_STEPS).toEqual([
      "collapsed",
      "1",
      "2",
      "3",
      "4",
      "5",
      "overview",
    ]);
  });

  it("parses numeric capture input with 0 as collapsed and 6 as overview", () => {
    expect(parseLayerStep(0)).toBe("collapsed");
    expect(parseLayerStep(3)).toBe("3");
    expect(parseLayerStep(6)).toBe("overview");
  });

  it("parses query-string and named input", () => {
    expect(parseLayerStep("overview")).toBe("overview");
    expect(parseLayerStep("5")).toBe("5");
    expect(parseLayerStep("collapsed")).toBe("collapsed");
  });

  it("returns null for anything else", () => {
    expect(parseLayerStep(7)).toBeNull();
    expect(parseLayerStep(1.5)).toBeNull();
    expect(parseLayerStep("network")).toBeNull();
    expect(parseLayerStep(null)).toBeNull();
  });

  it("moves forward and back without wrapping", () => {
    expect(stepOffset("collapsed", 1)).toBe("1");
    expect(stepOffset("5", 1)).toBe("overview");
    expect(stepOffset("overview", 1)).toBe("overview");
    expect(stepOffset("collapsed", -1)).toBe("collapsed");
  });

  it("maps a step to the active plane index", () => {
    expect(activePlaneIndex("1")).toBe(0);
    expect(activePlaneIndex("5")).toBe(4);
    expect(activePlaneIndex("collapsed")).toBeNull();
    expect(activePlaneIndex("overview")).toBeNull();
  });

  it("describes the current step for the stepper", () => {
    expect(stepStatus("collapsed")).toBe("Stacked");
    expect(stepStatus("1")).toBe("Layer 1 of 5");
    expect(stepStatus("5")).toBe("Layer 5 of 5");
    expect(stepStatus("overview")).toBe("All 5 layers");
  });

  it("maps scroll progress onto seven equal bands", () => {
    expect(stepForScrollProgress(0)).toBe("collapsed");
    expect(stepForScrollProgress(0.2)).toBe("1");
    expect(stepForScrollProgress(0.3)).toBe("2");
    expect(stepForScrollProgress(0.99)).toBe("overview");
    expect(stepForScrollProgress(1.4)).toBe("overview");
    expect(stepForScrollProgress(-1)).toBe("collapsed");
  });
});
