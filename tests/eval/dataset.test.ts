import { describe, expect, it } from "vitest";
import { GAME_TYPES } from "../../src/contract/game-types.ts";
import { hashTerm } from "../../scripts/clean-room-scan.ts";
import { privacyViolations } from "../../src/eval/dataset/privacy-guard.ts";
import {
  DATASET_PATH,
  Dataset,
  LENGTH_BANDS,
  checkDataset,
  countWords,
  loadDataset,
  type DatasetItem,
} from "../../src/eval/dataset/schema.ts";

const EXPECTED_PER_BAND = 5;
const EXPECTED_EN_PER_BAND = 3;
const EXPECTED_FR_PER_BAND = 2;
const EXPECTED_ITEMS = 20;

function item(overrides: Partial<DatasetItem> = {}): DatasetItem {
  return {
    id: "reed-hop",
    lengthBand: "terse",
    lang: "en",
    prompt: "reed hopper",
    intendedType: "arcade-run",
    probes: [],
    origin: "authored",
    ...overrides,
  };
}

describe("dataset schema (§11.1)", () => {
  it("rejects a bad id, an unknown band and a non-authored origin", () => {
    expect(
      Dataset.safeParse({ version: "v1", items: [item({ id: "Bad Id" })] })
        .success,
    ).toBe(false);
    expect(
      Dataset.safeParse({
        version: "v1",
        items: [{ ...item(), lengthBand: "huge" }],
      }).success,
    ).toBe(false);
    expect(
      Dataset.safeParse({
        version: "v1",
        items: [{ ...item(), origin: "scraped" }],
      }).success,
    ).toBe(false);
  });

  it("counts words on whitespace", () => {
    expect(countWords("  a paper   kite\nrises ")).toBe(4);
    expect(countWords("")).toBe(0);
  });

  it("flags duplicate ids and a word count outside the band", () => {
    const problems = checkDataset({
      version: "v1",
      items: [item(), item({ prompt: "one two three four five six" })],
    });
    expect(problems.some((line) => line.includes("duplicate id"))).toBe(true);
    expect(problems.some((line) => line.includes("words"))).toBe(true);
  });

  it("lets an edge item with a contradiction probe have any length", () => {
    const problems = checkDataset({
      version: "v1",
      items: [
        item({
          id: "calm-loss",
          lengthBand: "edge",
          prompt: "calm game you lose",
          probes: ["contradiction"],
        }),
      ],
    });
    expect(
      problems.some(
        (line) => line.includes("calm-loss") && line.includes("words"),
      ),
    ).toBe(false);
  });

  it("flags a band with one language and a game type named fewer than twice", () => {
    const problems = checkDataset({ version: "v1", items: [item()] });
    expect(
      problems.some((line) => line.includes("terse") && line.includes("fr")),
    ).toBe(true);
    expect(problems.some((line) => line.includes("toy-box"))).toBe(true);
  });
});

describe("privacy guard (§11.1)", () => {
  it.each([
    ["an email address", "mail kit.fox@example.org now"],
    ["a URL", "see https://example.org/game"],
    ["a bare www URL", "like www.example.org"],
    ["a UUID", "id 0f8fad5b-d9cb-469f-a165-70867728950e"],
    ["an ISO date", "due 2026-01-31"],
    ["a clock time", "at 14:05 sharp"],
    ["a long digit run", "code 123456789"],
    ["an @handle", "ask @reedfox about it"],
  ])("rejects %s", (_label, text) => {
    expect(privacyViolations(text)).not.toHaveLength(0);
  });

  it("rejects a token whose hash is on the denylist, and only that token", () => {
    const denylist = new Set([hashTerm("heron")]);
    expect(privacyViolations("a quiet heron", denylist)).toEqual([
      "denylisted term",
    ]);
    expect(privacyViolations("a quiet crane", denylist)).toEqual([]);
  });

  it("accepts ordinary authored prose", () => {
    expect(
      privacyViolations("A paper kite rides the wind over the rooftops."),
    ).toEqual([]);
  });
});

describe("committed dataset (dataset/prompts.v1.json)", () => {
  const dataset = loadDataset(DATASET_PATH);

  it("parses, passes every whole-set check and the privacy guard", () => {
    expect(checkDataset(dataset)).toEqual([]);
    for (const entry of dataset.items)
      expect(privacyViolations(`${entry.id} ${entry.prompt}`)).toEqual([]);
  });

  it("matches the §11.1 distribution", () => {
    expect(dataset.items).toHaveLength(EXPECTED_ITEMS);
    for (const band of LENGTH_BANDS) {
      const inBand = dataset.items.filter((entry) => entry.lengthBand === band);
      expect(inBand).toHaveLength(EXPECTED_PER_BAND);
      expect(inBand.filter((entry) => entry.lang === "en")).toHaveLength(
        EXPECTED_EN_PER_BAND,
      );
      expect(inBand.filter((entry) => entry.lang === "fr")).toHaveLength(
        EXPECTED_FR_PER_BAND,
      );
    }
    for (const type of GAME_TYPES)
      expect(
        dataset.items.filter((entry) => entry.intendedType === type).length,
      ).toBeGreaterThanOrEqual(2);
  });
});
