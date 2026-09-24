import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium } from "playwright";
import { describeMedia, verifyMedia } from "./capture/contract.ts";
import {
  type FrameSequence,
  addFrame,
  createSequence,
  encodeGif,
  framesFor,
  holdFrames,
} from "./capture/gif.ts";
import {
  captureRegion,
  closePage,
  finishTransitions,
  openPage,
  scrollToY,
  elementTop,
  topbarHeight,
} from "./capture/page.ts";
import { buildSite, startApi, startPreview } from "./capture/server.ts";

const SITE_DIR = resolve(import.meta.dirname, "..");
const MEDIA_DIR = resolve(SITE_DIR, "..", "docs", "media");
const PREVIEW_PORT = 4281;
const API_PORT = 4282;
const BASE_URL = `http://localhost:${String(PREVIEW_PORT)}/`;
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;
const GIF_VIEWPORT = { width: 1440, height: 1500 } as const;
const REGION_PADDING = 48;
const REPLAY_ITEM = "bubble-pop";
const REPLAY_TIMEOUT_MS = 120_000;
const LEAD_MS = 1000;
const EVENT_MS = 330;
const TAIL_MS = 3500;
const GIF_TOP = ".run__status";
const GIF_BOTTOM = ".run__log-box";

/** Path of a media file in the committed docs folder. */
function media(file: string): string {
  return join(MEDIA_DIR, file);
}

/** Top-of-page viewport screenshot, used for the desktop and mobile hero. */
async function captureTop(
  browser: Browser,
  viewport: typeof DESKTOP | typeof MOBILE,
  file: string,
): Promise<void> {
  const session = await openPage(browser, BASE_URL, viewport);
  await scrollToY(session.page, 0);
  await finishTransitions(session.page);
  await session.page.screenshot({ path: media(file), animations: "disabled" });
  await closePage(session, file);
}

/** The evaluation section at 1440. */
async function captureEvaluation(browser: Browser): Promise<void> {
  const session = await openPage(browser, BASE_URL, DESKTOP);
  await captureRegion(
    session,
    { top: "#evaluation .section-head", bottom: "#evaluation .eval-grid" },
    media("evaluation.png"),
    REGION_PADDING,
  );
  await closePage(session, "evaluation.png");
}

/**
 * The replay of a repaired item: run it against the real local API, then redraw the panel after
 * each received message through the capture hook, so every frame is a state the page really reached.
 */
async function captureReplayGif(
  browser: Browser,
  scratch: string,
): Promise<void> {
  const session = await openPage(browser, BASE_URL, GIF_VIEWPORT);
  const { page } = session;
  await page.selectOption("#prompt-picker", REPLAY_ITEM);
  await page.click("[data-run]");
  await page.waitForFunction(
    () => window.__replayPhase?.() === "complete",
    undefined,
    {
      timeout: REPLAY_TIMEOUT_MS,
    },
  );
  const count = await page.evaluate(() => window.__replayFrameCount?.() ?? 0);
  if (count === 0) throw new Error("The replay received no messages");
  const top = (await elementTop(page, GIF_TOP)) - REGION_PADDING;
  await scrollToY(page, top - (await topbarHeight(page)));
  const sequence = createSequence(scratch, "replay");
  const clip = await replayClip(page);
  const shoot = async (path: string): Promise<void> => {
    await page.screenshot({ path, animations: "disabled", clip });
  };
  await recordFrames(page, sequence, shoot, count);
  await closePage(session, "replay-run.gif");
  encodeGif(sequence, media("replay-run.gif"), "none");
}

/** A fixed clip around the replay board, measured on the finished run so every frame is the same size. */
async function replayClip(
  page: Parameters<typeof finishTransitions>[0],
): Promise<{ x: number; y: number; width: number; height: number }> {
  const first = await page.locator(GIF_TOP).boundingBox();
  const last = await page.locator(GIF_BOTTOM).boundingBox();
  if (first === null || last === null)
    throw new Error("Replay region not visible");
  const y = Math.floor(first.y - REGION_PADDING / 2);
  const height = Math.ceil(last.y + last.height - y + REGION_PADDING / 2);
  return { x: 0, y, width: GIF_VIEWPORT.width, height };
}

/** One GIF frame per received message, with a lead-in and a long hold on the finished run. */
async function recordFrames(
  page: Parameters<typeof finishTransitions>[0],
  sequence: FrameSequence,
  shoot: (path: string) => Promise<void>,
  count: number,
): Promise<void> {
  for (let frame = 0; frame <= count; frame += 1) {
    const drawn = await page.evaluate(
      (value) => window.__setReplayFrame?.(value) ?? -1,
      frame,
    );
    if (drawn !== frame)
      throw new Error(`Replay frame ${String(frame)} drew ${String(drawn)}`);
    await finishTransitions(page);
    await addFrame(sequence, shoot);
    const hold = frame === 0 ? LEAD_MS : frame === count ? TAIL_MS : EVENT_MS;
    holdFrames(sequence, Math.max(framesFor(hold) - 1, 0));
  }
}

/** Every capture in the media contract. */
async function captureAll(browser: Browser, scratch: string): Promise<void> {
  await captureTop(browser, DESKTOP, "hero.png");
  await captureTop(browser, MOBILE, "mobile-hero.png");
  await captureEvaluation(browser);
  await captureReplayGif(browser, scratch);
}

/** Build, serve the site and the keyless API, capture, then verify the media contract. */
async function main(): Promise<void> {
  buildSite(SITE_DIR);
  mkdirSync(MEDIA_DIR, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "cartridge-capture-"));
  const api = await startApi(SITE_DIR, API_PORT);
  const server = await startPreview(SITE_DIR, BASE_URL, PREVIEW_PORT);
  const browser = await chromium.launch();
  try {
    await captureAll(browser, scratch);
  } finally {
    await browser.close();
    server.kill();
    api.kill();
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(describeMedia(MEDIA_DIR).join("\n"));
  const problems = verifyMedia(MEDIA_DIR);
  if (problems.length > 0)
    throw new Error(`Media contract violated:\n${problems.join("\n")}`);
}

await main();
