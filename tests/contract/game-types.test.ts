import { describe, expect, it } from "vitest";
import {
  GAME_TYPES,
  GAME_TYPE_RULES,
  requiredEvents,
  forbiddenEvents,
} from "../../src/contract/game-types.ts";
import { GameSpec } from "../../src/contract/spec.ts";

describe("GAME_TYPE_RULES (§2.2)", () => {
  it("has one row per game type", () => {
    expect(Object.keys(GAME_TYPE_RULES).sort()).toEqual([...GAME_TYPES].sort());
  });

  it("toy-box forbids end and level and needs the hard reset path", () => {
    const toyBox = GAME_TYPE_RULES["toy-box"];
    expect(toyBox.end).toBe("forbidden");
    expect(toyBox.level).toBe("forbidden");
    expect(toyBox.endReasons).toEqual([]);
    expect(toyBox.reset).toBe("hard");
  });

  it("derives required and forbidden events", () => {
    expect(requiredEvents("arcade-run")).toEqual(["score", "end"]);
    expect(forbiddenEvents("arcade-run")).toEqual(["level"]);
    expect(requiredEvents("stage-clear")).toEqual(["level", "end"]);
    expect(forbiddenEvents("toy-box")).toEqual(["level", "end"]);
  });
});

describe("GameSpec (§4.2)", () => {
  const valid = {
    title: "Lantern Hop",
    slug: "lantern-hop",
    lang: "fr",
    gameType: "stage-clear",
    loop: "Hop between lanterns before the wind blows them out.",
    input: "tap-anywhere",
    style: "paper-cut",
  };

  it("accepts a valid spec", () => {
    expect(GameSpec.safeParse(valid).success).toBe(true);
  });

  it("rejects a bad slug, a long title and an unknown card id", () => {
    expect(GameSpec.safeParse({ ...valid, slug: "Lantern Hop" }).success).toBe(
      false,
    );
    expect(
      GameSpec.safeParse({ ...valid, title: "x".repeat(49) }).success,
    ).toBe(false);
    expect(GameSpec.safeParse({ ...valid, style: "pixel-art" }).success).toBe(
      false,
    );
    expect(GameSpec.safeParse({ ...valid, lang: "de" }).success).toBe(false);
  });
});
