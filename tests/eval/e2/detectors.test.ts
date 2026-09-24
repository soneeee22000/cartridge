import { describe, expect, it } from "vitest";
import {
  DETECTORS,
  createRegistry,
  evaluateDetectors,
  toE2Result,
} from "../../../src/eval/e2/detectors.ts";
import {
  BOOT_TIMEOUT_MS,
  IDLE_DEATH_MIN_SECONDS,
} from "../../../src/eval/e2/thresholds.ts";
import {
  DETECTOR_IDS,
  E2Result,
  type Observation,
} from "../../../src/eval/e2/types.ts";
import type { GameType } from "../../../src/contract/game-types.ts";

const MS = 1000;
const START_AT = 1_000;

function envelope(type: string, payload: object): unknown {
  return { source: "cartridge", v: 1, type, payload };
}

function boot(gameType: string, lang = "en"): unknown {
  return envelope("boot", { title: "Tide Sweep", gameType, lang });
}

function observation(overrides: Partial<Observation> = {}): Observation {
  const gameType: GameType = overrides.staticType ?? "arcade-run";
  return {
    staticType: gameType,
    staticLang: "en",
    loadedAtMs: 0,
    messages: [
      { t: 100, data: boot(gameType) },
      { t: START_AT, data: envelope("start", {}) },
    ],
    idleStartMs: START_AT,
    idleEndMs: START_AT + 6 * MS,
    frameA: { lumaStddev: 40, distinctColours: 200 },
    idleMotion: 0.05,
    tapMotion: 0.05,
    consoleErrors: [],
    longestPlaySeconds: 12,
    ...overrides,
  };
}

function endAt(seconds: number, reason = "lose"): { t: number; data: unknown } {
  return { t: START_AT + seconds * MS, data: envelope("end", { reason }) };
}

const verdicts = (obs: Observation) => evaluateDetectors(obs, DETECTORS);

describe("E2 detector registry (§8.2)", () => {
  it("registers exactly the six detectors, all enabled", () => {
    expect(DETECTORS.map((entry) => entry.id)).toEqual([...DETECTOR_IDS]);
    expect(DETECTORS.every((entry) => entry.enabled)).toBe(true);
  });

  it("passes a healthy observation on every detector", () => {
    const result = verdicts(observation());
    for (const id of DETECTOR_IDS) expect(result[id]).toBe("pass");
  });

  it("boot-handshake fails on a missing, late, malformed or mismatched boot", () => {
    const noBoot = observation({ messages: [] });
    const late = observation({
      messages: [{ t: BOOT_TIMEOUT_MS + 1, data: boot("arcade-run") }],
    });
    const malformed = observation({
      messages: [
        {
          t: 10,
          data: envelope("boot", {
            title: "",
            gameType: "arcade-run",
            lang: "en",
          }),
        },
      ],
    });
    const wrongType = observation({
      messages: [{ t: 10, data: boot("toy-box") }],
    });
    const wrongLang = observation({
      messages: [{ t: 10, data: boot("arcade-run", "fr") }],
    });
    for (const obs of [noBoot, late, malformed, wrongType, wrongLang])
      expect(verdicts(obs)["boot-handshake"]).toBe("fail");
  });

  it("blank-frame fails on low luma spread or few colours", () => {
    const flat = observation({
      frameA: { lumaStddev: 1, distinctColours: 90 },
    });
    const few = observation({ frameA: { lumaStddev: 30, distinctColours: 2 } });
    const missing = observation({ frameA: null });
    for (const obs of [flat, few, missing])
      expect(verdicts(obs)["blank-frame"]).toBe("fail");
  });

  it("idle-static applies only to types that must animate", () => {
    const still = { idleMotion: 0 };
    expect(verdicts(observation(still))["idle-static"]).toBe("fail");
    expect(
      verdicts(observation({ ...still, staticType: "stage-clear" }))[
        "idle-static"
      ],
    ).toBe("fail");
    expect(
      verdicts(observation({ ...still, staticType: "puzzle-board" }))[
        "idle-static"
      ],
    ).toBe("n/a");
    expect(
      verdicts(observation({ ...still, staticType: "toy-box" }))["idle-static"],
    ).toBe("n/a");
  });

  it("tap-unresponsive fails when a tap changes too few pixels", () => {
    expect(verdicts(observation({ tapMotion: 0 }))["tap-unresponsive"]).toBe(
      "fail",
    );
    expect(verdicts(observation({ tapMotion: null }))["tap-unresponsive"]).toBe(
      "fail",
    );
  });

  it("idle-death uses the min-seconds gate for arcade-run and stage-clear", () => {
    const early = IDLE_DEATH_MIN_SECONDS - 1;
    const late = IDLE_DEATH_MIN_SECONDS + 1;
    const run = (seconds: number, type: GameType) =>
      verdicts(
        observation({
          staticType: type,
          messages: [
            ...observation({ staticType: type }).messages,
            endAt(seconds),
          ],
        }),
      )["idle-death"];
    expect(run(early, "arcade-run")).toBe("fail");
    expect(run(late, "arcade-run")).toBe("pass");
    expect(run(early, "stage-clear")).toBe("fail");
  });

  it("idle-death fails on any end inside the window for puzzle-board and toy-box", () => {
    const late = IDLE_DEATH_MIN_SECONDS + 1;
    const withEnd = (type: GameType, seconds: number) =>
      observation({
        staticType: type,
        messages: [
          ...observation({ staticType: type }).messages,
          endAt(seconds, "stuck"),
        ],
      });
    expect(verdicts(withEnd("puzzle-board", late))["idle-death"]).toBe("fail");
    expect(verdicts(withEnd("toy-box", late))["idle-death"]).toBe("fail");
    expect(verdicts(withEnd("puzzle-board", 60))["idle-death"]).toBe("pass");
  });

  it("console-error fails on any forwarded error", () => {
    expect(
      verdicts(observation({ consoleErrors: ["error: x is undefined"] }))[
        "console-error"
      ],
    ).toBe("fail");
  });

  it("marks type-specific detectors n/a when the static type is unknown", () => {
    const unknown = { ...observation(), staticType: null };
    expect(verdicts(unknown)["idle-static"]).toBe("n/a");
    expect(verdicts(unknown)["idle-death"]).toBe("n/a");
  });

  it("a disabled detector reports n/a and is flagged disabled", () => {
    const registry = createRegistry(["console-error"]);
    const entry = registry.find((item) => item.id === "console-error");
    expect(entry?.enabled).toBe(false);
    const obs = observation({ consoleErrors: ["boom"] });
    expect(evaluateDetectors(obs, registry)["console-error"]).toBe("n/a");
  });

  it("rejects an unknown detector id", () => {
    expect(() => createRegistry(["no-such" as never])).toThrow(
      /unknown detector/,
    );
  });

  it("no registered detector reads longestPlaySeconds (reported only)", () => {
    const guarded = observation();
    Object.defineProperty(guarded, "longestPlaySeconds", {
      get: () => {
        throw new Error("a gate read longestPlaySeconds");
      },
    });
    for (const entry of DETECTORS)
      expect(() => entry.run(guarded)).not.toThrow();
  });

  it("builds a schema-valid e2 result that carries longestPlaySeconds", () => {
    const result = toE2Result(observation(), DETECTORS);
    expect(E2Result.parse(result).longestPlaySeconds).toBe(12);
    expect(result.metrics.idleMotionRatio).toBe(0.05);
    expect(result.metrics.firstEndSeconds).toBeNull();
  });
});
