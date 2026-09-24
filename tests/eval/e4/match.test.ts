import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runPlan } from "../../../src/engine/steps/plan.ts";
import { detectLanguage } from "../../../src/eval/e4/detect.ts";
import { extractUiStrings } from "../../../src/eval/e4/extract-ui-strings.ts";
import {
  LABELLED_NOTE,
  labelledSetStats,
  loadLabelledSet,
} from "../../../src/eval/e4/labelled.ts";
import {
  E4_MIN_LETTERS,
  E4_MIN_MARGIN,
  E4_MIN_STRINGS,
  classifyStrings,
  matchLanguage,
} from "../../../src/eval/e4/match.ts";
import { MOCK_GAME_HTML } from "../../../src/models/mock.ts";

const LABELLED_BUNDLES = 40;
const LABELLED_EN = 16;
const LABELLED_FR = 16;
const LABELLED_HARD = 8;
/** The figures SPEC §10.2 states for the labelled set; a threshold change must update both. */
const STATED_ACCURACY = 1;
const STATED_ABSTENTION_RATE = 0;
const STATED_EXPECTED_ABSTENTIONS_HIT = 1;

function page(body: string, script = "", lang = "en"): string {
  return `<!doctype html><html lang="${lang}"><head><title>T</title><style>.a { color: red; }</style></head><body>${body}<script>${script}</script></body></html>`;
}

describe("extractUiStrings (§10.2)", () => {
  it("reads text nodes outside script and style", () => {
    const strings = extractUiStrings(
      page("<h1>Catch the falling pears</h1><p>Tap the basket</p>"),
    );
    expect(strings).toContain("Catch the falling pears");
    expect(strings).toContain("Tap the basket");
    expect(strings.join(" ")).not.toContain("color");
  });

  it("reads fillText, strokeText, textContent, innerText and innerHTML literals", () => {
    const strings = extractUiStrings(
      page(
        "",
        [
          'ctx.fillText("Hit by a comet", 1, 2);',
          "ctx.strokeText('Round over', 1, 2);",
          'label.textContent = "Tap to fly again";',
          'note.innerText = "Keep going";',
          'box.innerHTML = "<b>Well</b> played";',
        ].join("\n"),
      ),
    );
    expect(strings).toEqual(
      expect.arrayContaining([
        "Hit by a comet",
        "Round over",
        "Tap to fly again",
        "Keep going",
        "Well played",
      ]),
    );
  });

  it("keeps the static parts of a template literal", () => {
    const strings = extractUiStrings(
      page("", "ctx.fillText(`Sparks left: ${count}`, 1, 2);"),
    );
    expect(strings).toContain("Sparks left:");
  });

  it("excludes the slug, identifiers, CSS, numbers and strings of two characters or fewer", () => {
    const strings = extractUiStrings(
      page(
        "<p>ok</p><p>42</p>",
        [
          'ctx.font = "bold 22px sans-serif";',
          'ctx.fillStyle = "#3d405b";',
          'window.addEventListener("pointerdown", go);',
          'const id = "lantern-dash";',
          'const key = "bestScore";',
          'ctx.fillText("Go", 1, 2);',
        ].join("\n"),
      ),
      { slug: "lantern-dash" },
    );
    expect(strings).toEqual([]);
  });

  it("also reads free-standing UI string literals such as panel line arrays", () => {
    const strings = extractUiStrings(
      page("", 'const lines = ["Hit by a comet", "Tap to fly again"];'),
    );
    expect(strings).toEqual(["Hit by a comet", "Tap to fly again"]);
  });

  it("returns distinct strings in first-seen order", () => {
    const strings = extractUiStrings(
      page("<p>Tap to start</p>", 'el.textContent = "Tap to start";'),
    );
    expect(strings).toEqual(["Tap to start"]);
  });
});

describe("classifyStrings abstention floor (§10.2)", () => {
  const english = [
    "Tap to start the run",
    "You hit a wall",
    "Collect the stars before the lights go out",
    "Try it again",
  ];

  it("decides a language with enough evidence", () => {
    expect(classifyStrings(english).lang).toBe("en");
  });

  it(`abstains below ${E4_MIN_STRINGS} distinct strings`, () => {
    const result = classifyStrings(english.slice(0, E4_MIN_STRINGS - 1));
    expect(result).toMatchObject({ lang: "abstain", reason: "few-strings" });
  });

  it(`abstains below ${E4_MIN_LETTERS} letters`, () => {
    const result = classifyStrings(["the a", "to be", "of it", "in an"]);
    expect(result).toMatchObject({ lang: "abstain", reason: "few-letters" });
  });

  it(`abstains below a margin of ${E4_MIN_MARGIN}`, () => {
    const result = classifyStrings([
      "Pommes et poires",
      "Apples and pears",
      "Cherries galore tonight",
      "Bananas everywhere somewhere",
    ]);
    expect(result).toMatchObject({ lang: "abstain", reason: "low-margin" });
  });
});

describe("matchLanguage (§10.2)", () => {
  it("scores match when the UI language equals the prompt language", () => {
    const html = page(
      "<h1>Catch the pears before they fall</h1><p>Tap the basket to move it</p>",
      'ctx.fillText("You missed the last pear", 1, 2); el.textContent = "Try it again from the start";',
    );
    expect(matchLanguage("en", html)).toMatchObject({
      verdict: "match",
      promptLang: "en",
      uiLang: "en",
      htmlLang: "en",
    });
  });

  it("abstains on the two-string mock game rather than calling it a match", () => {
    const result = matchLanguage("en", MOCK_GAME_HTML);
    expect(result).toMatchObject({
      verdict: "abstain",
      uiLang: null,
      htmlLang: "en",
    });
    expect(result.evidence.length).toBeLessThan(E4_MIN_STRINGS);
  });

  it("scores mismatch for an English UI on a French prompt", () => {
    const html = page(
      "<h1>Catch the pears before they fall</h1><p>Tap the basket to move it</p>",
      'ctx.fillText("You missed the last pear", 1, 2); el.textContent = "Try it again from the start";',
    );
    const result = matchLanguage("fr", html);
    expect(result).toMatchObject({ verdict: "mismatch", uiLang: "en" });
    expect(result.evidence.length).toBeGreaterThanOrEqual(E4_MIN_STRINGS);
  });

  it("scores match for a French UI on a French prompt", () => {
    const html = page(
      "<h1>Attrape les poires avant la chute</h1><p>Touche le panier pour le déplacer</p>",
      'ctx.fillText("Tu as raté la dernière poire", 1, 2); el.textContent = "Rejoue depuis le début";',
      "fr",
    );
    expect(matchLanguage("fr", html)).toMatchObject({
      verdict: "match",
      uiLang: "fr",
      htmlLang: "fr",
    });
  });

  it("abstains, never passes, when evidence is thin", () => {
    const result = matchLanguage("en", page("<p>Go!</p>"));
    expect(result.verdict).toBe("abstain");
    expect(result.uiLang).toBeNull();
  });
});

describe("E4 shares detectLanguage with the plan step (§4.2)", () => {
  it("plan.ts imports the same detector module", () => {
    const planSource = readFileSync(
      new URL("../../../src/engine/steps/plan.ts", import.meta.url),
      "utf8",
    );
    const matchSource = readFileSync(
      new URL("../../../src/eval/e4/match.ts", import.meta.url),
      "utf8",
    );
    expect(planSource).toContain('from "../../eval/e4/detect.ts"');
    expect(matchSource).toContain('from "./detect.ts"');
    expect(typeof runPlan).toBe("function");
    expect(typeof detectLanguage).toBe("function");
  });
});

describe("labelled set (§10.2)", () => {
  const bundles = loadLabelledSet();

  it("holds 16 EN, 16 FR and 8 hard bundles", () => {
    expect(bundles).toHaveLength(LABELLED_BUNDLES);
    expect(
      bundles.filter((bundle) => !bundle.hard && bundle.label === "en"),
    ).toHaveLength(LABELLED_EN);
    expect(
      bundles.filter((bundle) => !bundle.hard && bundle.label === "fr"),
    ).toHaveLength(LABELLED_FR);
    expect(bundles.filter((bundle) => bundle.hard)).toHaveLength(LABELLED_HARD);
  });

  it("computes and prints accuracy and abstention rate", () => {
    const stats = labelledSetStats(bundles);
    process.stdout.write(
      `E4 labelled set: accuracy ${stats.accuracy.toFixed(3)}, abstention ${stats.abstentionRate.toFixed(3)}, expected abstentions hit ${stats.expectedAbstentionsHit.toFixed(3)} (${LABELLED_NOTE})\n`,
    );
    expect(stats).toEqual({
      bundles: LABELLED_BUNDLES,
      accuracy: STATED_ACCURACY,
      abstentionRate: STATED_ABSTENTION_RATE,
      expectedAbstentionsHit: STATED_EXPECTED_ABSTENTIONS_HIT,
      wrongLanguage: 0,
    });
    expect(LABELLED_NOTE).toBe(
      "measured on 40 authored bundles; the thresholds were set on the same bundles",
    );
  });
});
