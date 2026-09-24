import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { systemClock, type Clock } from "../../engine/clock.ts";
import { demoMockModels } from "../../models/mock.ts";
import { createModel, type ModelMode } from "../../models/port.ts";
import { DATASET_PATH } from "../dataset/schema.ts";
import { createRegistry, toE2Result } from "../e2/detectors.ts";
import { DEFAULT_BOT, probeGame } from "../e2/probe.ts";
import type { E2Result } from "../e2/types.ts";
import { REPO_ROOT } from "../matrix.ts";
import { PRICES_CHECKED_ON_OFFICIAL_PAGE } from "../pricing.ts";
import { ITEM_TIMEOUT_MS } from "./generate.ts";

type Env = Readonly<Record<string, string | undefined>>;

export interface GeneratorModels {
  readonly planner: LanguageModelV4;
  readonly builder: LanguageModelV4;
}

/** Everything the `run` and `score --games` commands touch, injectable for tests. */
export interface EvalDeps {
  /** Repo root: `games/`, `cassettes/` and `reports/` live under it. */
  readonly root: string;
  readonly datasetPath: string;
  readonly clock: Clock;
  readonly env: Env;
  readonly timeoutMs: number;
  /** The date prices were re-checked on the official page, or null (§11.4). */
  readonly pricesChecked: string | null;
  readonly generatorModels: (
    mode: ModelMode,
    runKey: string,
  ) => GeneratorModels;
  /** The judge model, or null when E3 cannot run in this mode. */
  readonly judgeModel: (
    mode: ModelMode,
    runKey: string,
  ) => LanguageModelV4 | null;
  readonly probe: (html: string, itemId: string) => Promise<E2Result>;
  readonly scorerSha: () => string;
}

function cassetteDir(root: string, runKey: string): string {
  return join(root, "cassettes", runKey);
}

async function probeInChromium(
  html: string,
  itemId: string,
): Promise<E2Result> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const observation = await probeGame(browser, html, {
      id: itemId,
      bot: DEFAULT_BOT,
    });
    return toE2Result(observation, createRegistry());
  } finally {
    await browser.close();
  }
}

function gitSha(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * The real collaborators: models through the §7.1 port with per-item cassette directories,
 * Chromium for E2, and git for the scorer sha. In `mock` mode the generator uses the dev server's
 * stateless mock models and E3 does not run.
 * @param env process environment
 */
export function defaultEvalDeps(env: Env): EvalDeps {
  const root = REPO_ROOT;
  return {
    root,
    datasetPath: DATASET_PATH,
    clock: systemClock,
    env,
    timeoutMs: ITEM_TIMEOUT_MS,
    pricesChecked: PRICES_CHECKED_ON_OFFICIAL_PAGE,
    generatorModels: (mode, runKey) => {
      if (mode === "mock") return demoMockModels();
      const options = { cassetteDir: cassetteDir(root, runKey), env };
      return {
        planner: createModel("planner", mode, options),
        builder: createModel("builder", mode, options),
      };
    },
    judgeModel: (mode, runKey) =>
      mode === "mock"
        ? null
        : createModel("judge", mode, {
            cassetteDir: cassetteDir(root, runKey),
            env,
          }),
    probe: probeInChromium,
    scorerSha: () => gitSha(root),
  };
}
