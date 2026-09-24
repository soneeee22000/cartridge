import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CARD_IDS,
  cardCitation,
  getCard,
  listAnchors,
  listCards,
  resolveAnchor,
} from "../../src/cards/index.ts";
import {
  GAME_TYPES,
  GAME_TYPE_RULES,
  type GameType,
} from "../../src/contract/game-types.ts";
import { INPUT_CARD_IDS, STYLE_CARD_IDS } from "../../src/contract/spec.ts";

const MAX_BODY_LINES = 60;
const PALETTE_SIZE = 4;

describe("card loader (§3)", () => {
  afterEach(() => {
    delete process.env.CARTRIDGE_ASSET_ROOT;
  });

  it("lists all 12 cards sorted by id", () => {
    const ids = listCards().map((card) => card.id);
    expect(ids).toHaveLength(12);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids)).toEqual(new Set(CARD_IDS));
  });

  it("covers every game type, input and style id", () => {
    const ids = new Set<string>(CARD_IDS);
    for (const id of [
      ...GAME_TYPES,
      ...INPUT_CARD_IDS,
      ...STYLE_CARD_IDS,
      "game-page",
      "bridge",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("gives each card the right kind, a short body and known related ids", () => {
    for (const summary of listCards()) {
      const card = getCard(summary.id);
      expect(card.body.split("\n").length).toBeLessThanOrEqual(MAX_BODY_LINES);
      for (const related of card.related) {
        expect(CARD_IDS).toContain(related);
      }
    }
    expect(getCard("bridge").kind).toBe("contract");
    expect(getCard("toy-box").kind).toBe("type");
    expect(getCard("swipe-lanes").kind).toBe("input");
    expect(getCard("risograph").kind).toBe("style");
  });

  it("serialises the listing byte-stably", () => {
    expect(JSON.stringify(listCards())).toBe(JSON.stringify(listCards()));
  });

  it("gives each style card a four-colour palette", () => {
    for (const id of STYLE_CARD_IDS) {
      const hexes = getCard(id).body.match(/#[0-9a-f]{6}\b/gi) ?? [];
      expect(new Set(hexes.map((hex) => hex.toLowerCase())).size).toBe(
        PALETTE_SIZE,
      );
    }
  });

  it("rejects an unknown card id", () => {
    expect(() => getCard("pixel-art")).toThrow(/unknown card/);
  });

  it("resolves an anchor to its computed line", () => {
    const anchor = resolveAnchor("E1-10");
    expect(anchor.card).toBe("bridge");
    const line = getCard("bridge").lines[anchor.line - 1];
    expect(line).toContain("<!-- rule:E1-10 -->");
    expect(cardCitation(anchor)).toBe(`cards/bridge.md:${anchor.line}`);
  });

  it("resolves a per-card anchor and refuses ambiguity", () => {
    expect(resolveAnchor("E1-15", "puzzle-board").card).toBe("puzzle-board");
    expect(() => resolveAnchor("E1-15")).toThrow(/anchors/);
    expect(() => resolveAnchor("E1-99")).toThrow(/anchors/);
  });

  it("reads cards from CARTRIDGE_ASSET_ROOT when set", () => {
    const root = mkdtempSync(join(tmpdir(), "cartridge-cards-"));
    mkdirSync(join(root, "src", "cards"), { recursive: true });
    const card = getCard("bridge");
    writeFileSync(
      join(root, "src", "cards", "bridge.md"),
      card.lines.join("\n").replace(card.title, "Relocated bridge"),
    );
    process.env.CARTRIDGE_ASSET_ROOT = root;
    expect(getCard("bridge").title).toBe("Relocated bridge");
  });

  it("lists every anchor with its card and line", () => {
    const anchors = listAnchors();
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(getCard(anchor.card).lines[anchor.line - 1]).toContain(
        `rule:${anchor.ruleId}`,
      );
    }
  });
});

const ROW_FIELDS = {
  score: "score",
  level: "level",
  end: "end",
  "end reasons": "endReasons",
  reset: "reset",
  "idle death gate": "idleDeathGate",
  "idle motion required": "idleMotionRequired",
} as const;

function readContractRow(gameType: GameType): Record<string, string> {
  const row: Record<string, string> = {};
  for (const line of getCard(gameType).lines) {
    const match = /^\|\s*([a-z ]+?)\s*\|\s*`?([^|`]*?)`?\s*\|$/.exec(
      line.trim(),
    );
    if (match?.[1] && match[2] !== undefined && match[1] in ROW_FIELDS) {
      row[match[1]] = match[2];
    }
  }
  return row;
}

function expectedRow(gameType: GameType): Record<string, string> {
  const rules = GAME_TYPE_RULES[gameType];
  return {
    score: rules.score,
    level: rules.level,
    end: rules.end,
    "end reasons": rules.endReasons.length
      ? rules.endReasons.join(", ")
      : "none",
    reset: rules.reset,
    "idle death gate": rules.idleDeathGate,
    "idle motion required": rules.idleMotionRequired ? "yes" : "no",
  };
}

describe("type cards restate GAME_TYPE_RULES (§2.2)", () => {
  it.each(GAME_TYPES)("%s card table matches the rule table", (gameType) => {
    expect(readContractRow(gameType)).toEqual(expectedRow(gameType));
  });

  it.each(GAME_TYPES)("%s card includes a loop skeleton (§3)", (gameType) => {
    expect(getCard(gameType).body).toMatch(
      /^## Loop skeleton\n\n```js\n[\s\S]+?\n```$/m,
    );
  });

  it("the toy-box card states the hard reset requirement", () => {
    expect(resolveAnchor("E1-24").card).toBe("toy-box");
    expect(getCard("toy-box").body).toMatch(/clear-the-table/i);
  });
});
