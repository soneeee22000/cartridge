import { describe, expect, it } from "vitest";
import { FALLBACK_CATALOG } from "../data/fallback";
import { fullReport } from "../data/report";
import { optionLabel, parseCatalog, wasRepaired } from "./catalog";

describe("fallback catalog", () => {
  it("lists every recorded item, repaired ones first", () => {
    expect(FALLBACK_CATALOG).toHaveLength(20);
    expect(new Set(FALLBACK_CATALOG.map((entry) => entry.id))).toEqual(
      new Set(fullReport.items.map((item) => item.id)),
    );
    const firstPlain = FALLBACK_CATALOG.findIndex(
      (entry) => !wasRepaired(entry),
    );
    expect(FALLBACK_CATALOG.slice(0, firstPlain).every(wasRepaired)).toBe(true);
    expect(FALLBACK_CATALOG.slice(firstPlain).some(wasRepaired)).toBe(false);
    expect(FALLBACK_CATALOG[0]?.id).toBe("bubble-pop");
  });
});

describe("parseCatalog", () => {
  it("accepts the api shape", () => {
    const body = { items: FALLBACK_CATALOG };
    expect(parseCatalog(body)).toEqual(FALLBACK_CATALOG);
  });

  it("rejects empty, malformed or unsafe entries", () => {
    expect(parseCatalog({ items: [] })).toBeNull();
    expect(parseCatalog({})).toBeNull();
    expect(parseCatalog(null)).toBeNull();
    expect(
      parseCatalog({
        items: [
          {
            id: "../x",
            lang: "en",
            lengthBand: "terse",
            prompt: "p",
            buildAttempts: 1,
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("option labels", () => {
  it("names the recorded outcome", () => {
    const [first] = FALLBACK_CATALOG;
    expect(first && optionLabel(first)).toBe(
      "bubble-pop (en, terse, 1 repair)",
    );
    const plain = FALLBACK_CATALOG.find((entry) => entry.id === "tile-sort");
    expect(plain && optionLabel(plain)).toBe(
      "tile-sort (en, short-brief, first pass)",
    );
  });
});
