import { describe, expect, it } from "vitest";
import { LAYERS } from "../content/layers";
import { LIFECYCLE, LIFECYCLE_RULES, RELAY_RULES } from "../content/backend";
import { LIMITATIONS } from "../content/limits";
import { WHY_BLOCKS } from "../content/why";
import { fullReport } from "../data/report";
import { fill } from "../lib/dom";
import { copyValues, itemsPerBand } from "./values";

describe("copy values", () => {
  const values = copyValues(fullReport);

  it("derives the dataset shape and the noise-floor step from the report", () => {
    expect(values).toMatchObject({
      items: 20,
      bands: 4,
      perBand: 5,
      bandStep: 20,
      score: "1.000",
    });
    expect(fullReport.noiseFloor).toContain(
      `${String(values.bandStep)} points`,
    );
  });

  it("derives the runtime gap from the report", () => {
    expect(values).toMatchObject({ runtimeFails: 9, e2Passed: 11 });
  });

  it("counts the E3 labels and the ones discarded for a missing citation", () => {
    expect(values).toMatchObject({ e3Labels: 80, e3Discarded: 16 });
  });

  it("fills every placeholder in the section copy", () => {
    const templates = [
      ...LAYERS.flatMap((layer) => [
        layer.heading,
        ...layer.answer,
        layer.caveat ?? "",
      ]),
      ...WHY_BLOCKS.flatMap((block) => block.paragraphs),
      ...LIMITATIONS.map((item) => item.detail),
      ...LIFECYCLE.map((item) => item.meaning),
      ...LIFECYCLE_RULES,
      ...RELAY_RULES,
    ];
    for (const template of templates)
      expect(() => fill(template, values)).not.toThrow();
  });

  it("refuses to describe bands of different sizes as one size", () => {
    const uneven = {
      ...fullReport,
      bands: fullReport.bands.map((band, index) => ({
        ...band,
        n: band.n + index,
      })),
    };
    expect(() => itemsPerBand(uneven)).toThrow(/differ/);
  });
});
