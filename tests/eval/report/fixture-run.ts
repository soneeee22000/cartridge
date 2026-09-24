import type { ItemRecord } from "../../../src/eval/report/types.ts";
import type { E2Result } from "../../../src/eval/e2/types.ts";
import type { E3Result } from "../../../src/eval/e3/validate.ts";

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const E2_PASS = {
  detectors: {
    "boot-handshake": "pass",
    "blank-frame": "pass",
    "idle-static": "pass",
    "tap-unresponsive": "pass",
    "idle-death": "pass",
    "console-error": "pass",
  },
  metrics: {
    bootMs: 120.25,
    lumaStddev: 30.5,
    distinctColours: 40,
    idleMotionRatio: 0.012345,
    tapMotionRatio: 0.05,
    firstEndSeconds: null,
  },
  longestPlaySeconds: 11.4567,
  consoleErrors: [],
} satisfies E2Result;

const E2_IDLE_DEATH = {
  ...E2_PASS,
  detectors: { ...E2_PASS.detectors, "idle-death": "fail" },
  metrics: { ...E2_PASS.metrics, firstEndSeconds: 0.8 },
} satisfies E2Result;

const E3_FULL = {
  dimensions: {
    "prompt-coverage": "covered",
    "goal-legibility": "implied",
    "feedback-on-input": "immediate",
    "fail-state-clarity": null,
  },
  discarded: [{ dimension: "fail-state-clarity", reason: "quote-not-found" }],
  judgeError: null,
} satisfies E3Result;

function game(
  id: string,
  band: ItemRecord["lengthBand"],
  lang: "en" | "fr",
  overrides: Partial<ItemRecord> = {},
): ItemRecord {
  return {
    id,
    lengthBand: band,
    lang,
    intendedType: "arcade-run",
    gameType: "arcade-run",
    outcome: "game",
    failure: null,
    e1Score: 1,
    e2: E2_PASS,
    e3: E3_FULL,
    e4: {
      verdict: "match",
      promptLang: lang,
      uiLang: lang,
      htmlLang: lang,
      evidence: [
        "Tap to fly again",
        "Hit by a comet",
        "Comet Lanes",
        "Tap to launch",
      ],
    },
    buildAttempts: 1,
    repairRules: [],
    usage: {
      generator: {
        input: 1_000,
        output: 2_000,
        cacheRead: 500,
        cacheWrite: 100,
      },
      judge: { input: 300, output: 50, cacheRead: 0, cacheWrite: 0 },
    },
    repairUsage: ZERO,
    wallMs: 30_000,
    ...overrides,
  };
}

/** A small hand-made run: every band, every outcome, a repair and an E2 failure. */
export function fixtureItems(): ItemRecord[] {
  return [
    game("zeta-terse", "terse", "en"),
    game("alpha-terse", "terse", "fr", {
      e1Score: 0.9166666,
      buildAttempts: 2,
      repairRules: ["E1-13"],
      repairUsage: { input: 400, output: 800, cacheRead: 700, cacheWrite: 0 },
      e2: E2_IDLE_DEATH,
    }),
    game("brief-a", "short-brief", "en", {
      outcome: "contract-failed",
      failure: {
        step: "generate",
        code: "contract-unmet",
        ruleIds: ["E1-11", "E1-13"],
      },
      e1Score: null,
      e2: null,
      e3: null,
      e4: null,
      buildAttempts: 4,
      repairRules: ["E1-13", "E1-11", "E1-13"],
    }),
    game("brief-b", "full-brief", "fr", {
      outcome: "refusal",
      failure: { step: "plan", code: "model-refusal", ruleIds: [] },
      gameType: null,
      e1Score: null,
      e2: null,
      e3: null,
      e4: null,
      buildAttempts: 0,
    }),
    game("edge-a", "edge", "en", {
      outcome: "harness-failure",
      failure: { step: "driver", code: "timeout", ruleIds: [] },
      gameType: null,
      e1Score: null,
      e2: null,
      e3: null,
      e4: null,
      buildAttempts: 0,
      wallMs: null,
    }),
    game("edge-b", "edge", "fr", {
      gameType: "toy-box",
      intendedType: "toy-box",
      e3: {
        dimensions: {
          "prompt-coverage": "partly",
          "goal-legibility": null,
          "feedback-on-input": "none",
          "fail-state-clarity": "n/a",
        },
        discarded: [],
        judgeError: null,
      },
      e4: {
        verdict: "abstain",
        promptLang: "fr",
        uiLang: null,
        htmlLang: "fr",
        evidence: ["Jouer"],
      },
    }),
  ];
}
