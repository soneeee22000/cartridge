import { readFileSync } from "node:fs";
import type { Browser, Frame as PlaywrightFrame, Page } from "playwright";
import { parseGame } from "../e1/document.ts";
import { mulberry32, seedFromId, tapPlan } from "./bot.ts";
import { instrumentGame } from "./instrument.ts";
import {
  decodePng,
  distinctColours,
  lumaStddev,
  motionRatio,
  type Frame,
} from "./metrics.ts";
import {
  BOOT_TIMEOUT_MS,
  BOT_TAP_GAP_MIN_MS,
  BOT_TRIAL_MAX_SECONDS,
  BOT_TRIALS,
  FRAME_GAP_MS,
  IDLE_FRAME_DELAY_MS,
  IDLE_WINDOW_SECONDS,
  PROBE_VIEWPORT,
  RESET_SETTLE_MS,
  START_TIMEOUT_MS,
} from "./thresholds.ts";
import type { Observation, TimedMessage } from "./types.ts";

/** Random-tap bot budget; `null` in `ProbeOptions` skips the bot. */
export interface BotConfig {
  readonly trials: number;
  readonly trialMaxSeconds: number;
}

export interface ProbeOptions {
  /** Seeds the bot's PRNG (§8.2 step 5). */
  readonly id: string;
  readonly bot: BotConfig | null;
}

/** The §8.3 bot budget. */
export const DEFAULT_BOT: BotConfig = {
  trials: BOT_TRIALS,
  trialMaxSeconds: BOT_TRIAL_MAX_SECONDS,
};

const MS_PER_SECOND = 1000;
const CENTRE = { x: PROBE_VIEWPORT.width / 2, y: PROBE_VIEWPORT.height / 2 };
const HOST_TEMPLATE = readFileSync(
  new URL("./host.html", import.meta.url),
  "utf8",
);

interface ProbeLog {
  readonly loadedAt: number;
  readonly messages: TimedMessage[];
  readonly errors: { kind: string; message: string }[];
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Builds the host page that embeds the instrumented game as a sandboxed srcdoc iframe.
 * @param html the game document
 */
export function hostPage(html: string): string {
  return HOST_TEMPLATE.replace("{{WIDTH}}", String(PROBE_VIEWPORT.width))
    .replace("{{HEIGHT}}", String(PROBE_VIEWPORT.height))
    .replace("{{SRCDOC}}", () => escapeAttribute(instrumentGame(html)));
}

/**
 * Loads the host with the game and returns the game's frame.
 * @param page a page at `PROBE_VIEWPORT`
 * @param html the game document
 */
export async function loadGame(
  page: Page,
  html: string,
): Promise<PlaywrightFrame> {
  await page.setContent(hostPage(html), { waitUntil: "load" });
  const frame = page
    .frames()
    .find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("the game frame did not load");
  return frame;
}

async function hostNow(page: Page): Promise<number> {
  return page.evaluate<number>("performance.now()");
}

async function readLog(page: Page): Promise<ProbeLog> {
  return page.evaluate<ProbeLog>("window.__probe");
}

async function sleepUntil(page: Page, hostMs: number): Promise<void> {
  const remaining = hostMs - (await hostNow(page));
  if (remaining > 0) await page.waitForTimeout(remaining);
}

async function waitForMessage(
  page: Page,
  type: string,
  afterMs: number,
  timeoutMs: number,
): Promise<TimedMessage | null> {
  const test = `window.__probe.messages.some((m) => m.data.type === ${JSON.stringify(type)} && m.t >= ${String(afterMs)})`;
  try {
    await page.waitForFunction(test, undefined, { timeout: timeoutMs });
  } catch {
    return null;
  }
  const log = await readLog(page);
  return findMessage(log.messages, type, afterMs);
}

function findMessage(
  messages: readonly TimedMessage[],
  type: string,
  afterMs: number,
): TimedMessage | null {
  const found = messages.find(
    (message) =>
      (message.data as { type?: unknown }).type === type &&
      message.t >= afterMs,
  );
  return found ?? null;
}

async function capture(page: Page): Promise<Frame> {
  return decodePng(await page.locator("iframe").screenshot());
}

async function tapAt(page: Page, x: number, y: number): Promise<number> {
  const at = await hostNow(page);
  await page.mouse.click(x, y);
  return at;
}

/** Step 2: `start` may already have arrived (toy-box); otherwise tap the centre and wait. */
async function beginPlay(page: Page): Promise<number> {
  const early = findMessage((await readLog(page)).messages, "start", 0);
  if (early) return early.t;
  const tappedAt = await tapAt(page, CENTRE.x, CENTRE.y);
  const start = await waitForMessage(page, "start", tappedAt, START_TIMEOUT_MS);
  return start ? start.t : tappedAt;
}

interface IdleResult {
  readonly frameA: Frame;
  readonly idleMotion: number;
  readonly idleEndMs: number;
}

/** Step 3: no input for the idle window; frames A and B early in it. */
async function idleWindow(
  page: Page,
  idleStartMs: number,
): Promise<IdleResult> {
  await sleepUntil(page, idleStartMs + IDLE_FRAME_DELAY_MS);
  const frameA = await capture(page);
  await page.waitForTimeout(FRAME_GAP_MS);
  const frameB = await capture(page);
  const idleEndMs = idleStartMs + IDLE_WINDOW_SECONDS * MS_PER_SECOND;
  await sleepUntil(page, idleEndMs);
  return { frameA, idleMotion: motionRatio(frameA, frameB), idleEndMs };
}

async function resetGame(page: Page): Promise<void> {
  await page.evaluate('window.__probeSend("reset")');
  await page.waitForTimeout(RESET_SETTLE_MS);
}

/** Step 4: `reset`, then a centre tap between two frames. */
async function tapPair(page: Page): Promise<number> {
  await resetGame(page);
  const before = await capture(page);
  await tapAt(page, CENTRE.x, CENTRE.y);
  await page.waitForTimeout(FRAME_GAP_MS);
  return motionRatio(before, await capture(page));
}

async function botTrial(
  page: Page,
  random: () => number,
  trialMaxSeconds: number,
): Promise<number> {
  await resetGame(page);
  const trialStart = await hostNow(page);
  const capMs = trialMaxSeconds * MS_PER_SECOND;
  const taps = tapPlan(random, Math.ceil(capMs / BOT_TAP_GAP_MIN_MS));
  for (const tap of taps) {
    await page.waitForTimeout(tap.gapMs);
    const end = findMessage((await readLog(page)).messages, "end", trialStart);
    if (end) return (end.t - trialStart) / MS_PER_SECOND;
    if ((await hostNow(page)) - trialStart >= capMs) break;
    await page.mouse.click(tap.x, tap.y);
  }
  return trialMaxSeconds;
}

/** Step 5: reported only; the longest time to `end`, or the trial cap. */
async function randomTapBot(
  page: Page,
  options: ProbeOptions,
): Promise<number | null> {
  if (!options.bot) return null;
  const random = mulberry32(seedFromId(options.id));
  let longest = 0;
  for (let trial = 0; trial < options.bot.trials; trial += 1)
    longest = Math.max(
      longest,
      await botTrial(page, random, options.bot.trialMaxSeconds),
    );
  return longest;
}

async function drive(page: Page, html: string, options: ProbeOptions) {
  await loadGame(page, html);
  const { loadedAt } = await readLog(page);
  await waitForMessage(page, "boot", 0, BOOT_TIMEOUT_MS);
  const idleStartMs = await beginPlay(page);
  const idle = await idleWindow(page, idleStartMs);
  const tapMotion = await tapPair(page);
  const longestPlaySeconds = await randomTapBot(page, options);
  return {
    loadedAt,
    idleStartMs,
    idle,
    tapMotion,
    longestPlaySeconds,
    log: await readLog(page),
  };
}

/**
 * Runs the §8.2 sequence on one game in a fresh page and returns the raw observation.
 * @param browser a launched Chromium
 * @param html the game document
 * @param options item id (bot seed) and bot budget
 */
export async function probeGame(
  browser: Browser,
  html: string,
  options: ProbeOptions,
): Promise<Observation> {
  const page = await browser.newPage({ viewport: PROBE_VIEWPORT });
  try {
    const run = await drive(page, html, options);
    const parsed = parseGame(html, {});
    return {
      staticType: parsed.declaredType,
      staticLang: parsed.htmlLang,
      loadedAtMs: run.loadedAt,
      messages: run.log.messages,
      idleStartMs: run.idleStartMs,
      idleEndMs: run.idle.idleEndMs,
      frameA: {
        lumaStddev: lumaStddev(run.idle.frameA),
        distinctColours: distinctColours(run.idle.frameA),
      },
      idleMotion: run.idle.idleMotion,
      tapMotion: run.tapMotion,
      consoleErrors: run.log.errors.map(
        (entry) => `${entry.kind}: ${entry.message}`,
      ),
      longestPlaySeconds: run.longestPlaySeconds,
    };
  } finally {
    await page.close();
  }
}
