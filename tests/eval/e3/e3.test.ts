import { describe, expect, it } from "vitest";
import type { GameSpec } from "../../../src/contract/spec.ts";
import { runJudge } from "../../../src/eval/e3/judge.ts";
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  JUDGE_INSTRUCTIONS,
  judgeMessage,
  numberLines,
} from "../../../src/eval/e3/rubric.ts";
import {
  E3_MIN_QUOTE_CHARS,
  E3_NUMERIC_CLAIM,
  discardReason,
  summariseJudgement,
  type JudgeFinding,
} from "../../../src/eval/e3/validate.ts";
import {
  MOCK_GAME_HTML,
  MOCK_SPEC,
  scriptedTurns,
} from "../../../src/models/mock.ts";
import { CassetteMissError } from "../../../src/models/cassette.ts";
import { assertNoVolatile } from "../../../src/models/request-key.ts";

const HTML = [
  "<!doctype html>",
  '<html lang="en">',
  "<body>",
  '<p id="goal">Catch every falling pear</p>',
  "<script>",
  'canvas.addEventListener("pointerdown", () => { basket.x = event.x; draw(); });',
  'function over() { banner.textContent = "A pear hit the ground. Tap to retry"; }',
  "</script>",
  "</body>",
  "</html>",
].join("\n");
const LINES = HTML.split("\n");

function finding(overrides: Partial<JudgeFinding> = {}): JudgeFinding {
  return {
    dimension: "goal-legibility",
    label: "stated",
    evidence: [{ line: 4, quote: "Catch every falling pear" }],
    rationale: "The goal is written in a paragraph at the top.",
    ...overrides,
  };
}

const TOY_SPEC: GameSpec = { ...MOCK_SPEC, gameType: "toy-box" };

describe("E3 rubric (§10.1)", () => {
  it("has four categorical dimensions with three labels each and no numbers", () => {
    expect(DIMENSIONS).toEqual([
      "prompt-coverage",
      "goal-legibility",
      "feedback-on-input",
      "fail-state-clarity",
    ]);
    for (const dimension of DIMENSIONS)
      expect(DIMENSION_LABELS[dimension]).toHaveLength(3);
    expect(JUDGE_INSTRUCTIONS).not.toMatch(/\d/);
  });

  it("bounds the answer so a judge cannot repeat findings until the output cap truncates it", () => {
    expect(JUDGE_INSTRUCTIONS).toContain("at most one finding per dimension");
    expect(JUDGE_INSTRUCTIONS).toContain("at most three evidence items");
    expect(JUDGE_INSTRUCTIONS).toContain("stop");
  });

  it("prefixes 1-based line numbers", () => {
    expect(numberLines("a\nb")).toBe("1| a\n2| b");
  });

  it("builds a stable message with the brief, the plan and the numbered source", () => {
    const message = judgeMessage("A pear game", MOCK_SPEC, HTML);
    expect(message).toContain("A pear game");
    expect(message).toContain('"slug":"lantern-dash"');
    expect(message).toContain("4| <p id=");
    expect(judgeMessage("A pear game", MOCK_SPEC, HTML)).toBe(message);
    expect(() => {
      assertNoVolatile({ message });
    }).not.toThrow();
  });
});

describe("E3 validation: discard reasons (§10.1)", () => {
  it("keeps a finding whose quote is on the cited line", () => {
    expect(discardReason(finding(), LINES)).toBeNull();
  });

  it("tolerates the quote being one line away and whitespace differences", () => {
    expect(
      discardReason(
        finding({
          evidence: [{ line: 5, quote: "Catch  every\tfalling pear" }],
        }),
        LINES,
      ),
    ).toBeNull();
  });

  it.each<[string, Partial<JudgeFinding>]>([
    ["no-evidence", { evidence: [] }],
    [
      "line-out-of-range",
      { evidence: [{ line: 0, quote: "Catch every falling pear" }] },
    ],
    [
      "line-out-of-range",
      { evidence: [{ line: 99, quote: "Catch every falling pear" }] },
    ],
    ["quote-too-short", { evidence: [{ line: 4, quote: "pear" }] }],
    [
      "quote-not-found",
      { evidence: [{ line: 8, quote: "Catch every falling pear" }] },
    ],
    ["numeric-claim", { rationale: "About 80% of the brief is covered." }],
    ["numeric-claim", { rationale: "It scores 7/10 on clarity." }],
    ["numeric-claim", { rationale: "It runs at 60 fps." }],
    ["numeric-claim", { rationale: "Each pear is worth 5 points." }],
    ["numeric-claim", { rationale: "The brief is met 3 out of 4 ways." }],
    [
      "quote-not-found",
      {
        evidence: [
          { line: 4, quote: "Catch every falling pear" },
          { line: 4, quote: "Dodge the falling plums" },
        ],
      },
    ],
    [
      "line-out-of-range",
      {
        evidence: [
          { line: 4, quote: "Catch every falling pear" },
          { line: 42, quote: "Catch every falling pear" },
        ],
      },
    ],
    ["unknown-label", { label: "excellent" }],
  ])("discards with %s", (reason, overrides) => {
    expect(discardReason(finding(overrides), LINES)).toBe(reason);
  });

  it("uses a minimum quote length and a numeric-claim pattern", () => {
    expect(E3_MIN_QUOTE_CHARS).toBe(6);
    expect(E3_NUMERIC_CLAIM.test("three of the four nouns appear")).toBe(false);
    expect(E3_NUMERIC_CLAIM.test("12 out of 20 nouns")).toBe(true);
    expect(E3_NUMERIC_CLAIM.test("worth 5 points")).toBe(true);
    expect(E3_NUMERIC_CLAIM.test("redraws after 16 ms")).toBe(true);
  });
});

describe("E3 summary: null, not zero (§10.1)", () => {
  it("scores a dimension with no surviving finding as null, never the worst label", () => {
    const result = summariseJudgement(
      {
        findings: [
          finding(),
          finding({
            dimension: "prompt-coverage",
            label: "missed",
            evidence: [],
          }),
        ],
      },
      HTML,
      MOCK_SPEC.gameType,
    );
    expect(result.dimensions["goal-legibility"]).toBe("stated");
    expect(result.dimensions["prompt-coverage"]).toBeNull();
    expect(result.dimensions["feedback-on-input"]).toBeNull();
    expect(result.discarded).toEqual([
      { dimension: "prompt-coverage", reason: "no-evidence" },
    ]);
    expect(result.judgeError).toBeNull();
  });

  it("reports fail-state-clarity as n/a for toy-box, separately from null", () => {
    const result = summariseJudgement(
      {
        findings: [
          finding({
            dimension: "fail-state-clarity",
            label: "explained",
            evidence: [{ line: 7, quote: "A pear hit the ground" }],
          }),
        ],
      },
      HTML,
      TOY_SPEC.gameType,
    );
    expect(result.dimensions["fail-state-clarity"]).toBe("n/a");
    expect(result.dimensions["goal-legibility"]).toBeNull();
  });

  it("makes every dimension null and records judgeError for an unparseable response", () => {
    const result = summariseJudgement({ verdict: "great" }, HTML, "arcade-run");
    for (const dimension of DIMENSIONS)
      expect(result.dimensions[dimension]).toBeNull();
    expect(result.judgeError).toMatch(/unparseable/);
  });

  it("ignores judge findings on fail-state-clarity for toy-box instead of discarding them", () => {
    const result = summariseJudgement(
      {
        findings: [
          finding({
            dimension: "fail-state-clarity",
            label: "missing",
            evidence: [],
          }),
        ],
      },
      HTML,
      "toy-box",
    );
    expect(result.dimensions["fail-state-clarity"]).toBe("n/a");
    expect(result.discarded).toEqual([]);
  });

  it("keeps a dimension null when its only finding is discarded, even with a worst label", () => {
    const result = summariseJudgement(
      {
        findings: [
          finding({
            dimension: "feedback-on-input",
            label: "none",
            evidence: [{ line: 6, quote: "not on this line at all" }],
          }),
        ],
      },
      HTML,
      "arcade-run",
    );
    expect(result.dimensions["feedback-on-input"]).toBeNull();
    expect(result.discarded).toEqual([
      { dimension: "feedback-on-input", reason: "quote-not-found" },
    ]);
  });

  it("keeps the first surviving finding when a dimension has several", () => {
    const result = summariseJudgement(
      {
        findings: [
          finding({ label: "implied", rationale: "7 out of 9" }),
          finding({ label: "stated" }),
          finding({ label: "absent" }),
        ],
      },
      HTML,
      "arcade-run",
    );
    expect(result.dimensions["goal-legibility"]).toBe("stated");
  });
});

describe("E3 judge with a mock model (§10.1)", () => {
  const lines = MOCK_GAME_HTML.split("\n");
  const titleLine = lines.findIndex((line) => line.includes("<title>")) + 1;

  it("returns validated labels and the call's usage", async () => {
    const response = {
      findings: [
        {
          dimension: "goal-legibility",
          label: "implied",
          evidence: [{ line: titleLine, quote: "<title>Lantern Dash</title>" }],
          rationale: "Only the title hints at the goal.",
        },
      ],
    };
    const judged = await runJudge(
      scriptedTurns([
        {
          kind: "text",
          text: JSON.stringify(response),
          usage: { input: 40, output: 9 },
        },
      ]),
      { prompt: "A lantern game", spec: MOCK_SPEC, html: MOCK_GAME_HTML },
    );
    expect(judged.result.dimensions["goal-legibility"]).toBe("implied");
    expect(judged.result.dimensions["prompt-coverage"]).toBeNull();
    expect(judged.result.judgeError).toBeNull();
    expect(judged.usage).toEqual({
      input: 40,
      output: 9,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("records judgeError when the model returns prose instead of findings", async () => {
    const judged = await runJudge(
      scriptedTurns([{ kind: "text", text: "It is a lovely game." }]),
      { prompt: "A lantern game", spec: MOCK_SPEC, html: MOCK_GAME_HTML },
    );
    expect(judged.result.judgeError).not.toBeNull();
    for (const dimension of DIMENSIONS)
      expect(judged.result.dimensions[dimension]).toBeNull();
  });

  it("records a portable judgeError for a cassette miss, with no path or key in it", async () => {
    const judged = await runJudge(
      scriptedTurns([
        {
          kind: "error",
          error: new CassetteMissError(
            "no cassette for sha256:abc in C:\\some\\machine\\cassettes\\x",
          ),
        },
      ]),
      { prompt: "A lantern game", spec: MOCK_SPEC, html: MOCK_GAME_HTML },
    );
    expect(judged.result.judgeError).toBe("judge cassette missing");
  });

  it("records judgeError when the model call throws", async () => {
    const judged = await runJudge(
      scriptedTurns([{ kind: "error", error: new Error("overloaded") }]),
      { prompt: "A lantern game", spec: MOCK_SPEC, html: MOCK_GAME_HTML },
    );
    expect(judged.result.judgeError).not.toBeNull();
  });
});
