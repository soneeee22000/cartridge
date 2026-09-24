import { describe, expect, it } from "vitest";
import { detectLanguage } from "../../../src/eval/e4/detect.ts";

describe("detectLanguage (§10.2)", () => {
  it("detects an English brief", () => {
    const result = detectLanguage("A fox runs through the woods and the player collects acorns");
    expect(result.lang).toBe("en");
    expect(result.margin).toBeGreaterThan(0);
  });

  it("detects a French brief, including elided articles", () => {
    expect(detectLanguage("Un renard court dans la forêt et le joueur ramasse des glands").lang).toBe("fr");
    expect(detectLanguage("l'escargot qui glisse sur l'herbe").lang).toBe("fr");
  });

  it("returns unknown when the evidence ties or is absent", () => {
    expect(detectLanguage("neon frog")).toEqual({ lang: "unknown", margin: 0 });
    expect(detectLanguage("").lang).toBe("unknown");
  });
});
