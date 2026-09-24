import { AGENT_TOOLS, CARD_KINDS } from "../content/engine";
import { svgRect, svgText } from "../lib/svg";
import type { Report } from "../types/report";
import type { CatalogEntry } from "../viewmodel/catalog";
import { barShare } from "../viewmodel/evaluation";
import { formatCount, formatScore } from "../viewmodel/format";
import { graphLayout } from "../viewmodel/graph";
import { DETECTOR_ORDER, headlineFacts } from "../viewmodel/results";
import { type GraphView, graphContent } from "./workflow-graph";

const WIDTH = 520;
const HEIGHT = 340;
const MARGIN = 24;
const CHIP_HEIGHT = 30;
const CHIP_RADIUS = 2;
const CHIP_TEXT_X = 12;
const CHIP_BASELINE = 20;
const CHIP_PITCH = 40;
const TITLE_Y = 34;
const FIRST_ROW_Y = 56;
const PROMPT_CHARS = 44;
const COLUMN_GAP = 16;
const BAR_HEIGHT = 34;
const DETAIL = "surface-detail";

/** Wrap surface content in the plane's SVG. */
function surface(content: string): string {
  return `<svg class="plane-surface" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true" focusable="false">${content}</svg>`;
}

/** A labelled chip at a position. */
function chip(
  x: number,
  y: number,
  width: number,
  text: string,
  tone = "",
): string {
  return `${svgRect(x, y, width, CHIP_HEIGHT, `svg-chip ${tone}`, CHIP_RADIUS)}${svgText(x + CHIP_TEXT_X, y + CHIP_BASELINE, text, "svg-mono svg-mono--small")}`;
}

/** Shorten a prompt for a chip, on a word boundary. */
export function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit).replace(/\s+\S*$/, "");
  return `${cut}…`;
}

/** Plane 1: real prompts from three bands. */
export function requestSurface(
  catalog: readonly CatalogEntry[],
  report: Report,
): string {
  const bands = ["terse", "short-brief", "edge"];
  const picks = bands
    .map((band) => catalog.find((entry) => entry.lengthBand === band))
    .filter((entry): entry is CatalogEntry => entry !== undefined);
  const chips = picks
    .map((entry, index) =>
      chip(
        MARGIN,
        FIRST_ROW_Y + index * CHIP_PITCH * 2,
        WIDTH - MARGIN * 2,
        `${entry.lang} · ${clip(entry.prompt, PROMPT_CHARS)}`,
      ),
    )
    .join("");
  const note = `${String(report.totals.n)} prompts · ${String(report.bands.length)} length bands`;
  return surface(
    `${svgText(MARGIN, TITLE_Y, "Briefs from the dataset", "svg-text svg-strong")}${chips}${svgText(MARGIN, HEIGHT - MARGIN, note, `svg-text svg-muted ${DETAIL}`)}`,
  );
}

/** Plane 2: the workflow graph itself, before any run. */
export function graphSurface(): string {
  const layout = graphLayout("wide");
  const scale = (WIDTH - MARGIN * 2) / layout.width;
  const view: GraphView = {
    nodes: {
      plan: "idle",
      generate: "idle",
      verify: "idle",
      repair: "idle",
      finalize: "idle",
      reject: "idle",
    },
    edges: [],
  };
  const title = svgText(
    MARGIN,
    TITLE_Y,
    "plan, build cycle, finalize or reject",
    "svg-text svg-strong",
  );
  return surface(
    `${title}<g transform="translate(${String(MARGIN)} ${String(FIRST_ROW_Y + MARGIN)}) scale(${scale.toFixed(3)})">${graphContent(layout, view)}</g>`,
  );
}

/** Plane 3: the four agent tools and the card kinds. */
export function toolsSurface(): string {
  const half = (WIDTH - MARGIN * 2 - COLUMN_GAP) / 2;
  const tools = AGENT_TOOLS.map((tool, index) =>
    chip(MARGIN, FIRST_ROW_Y + index * CHIP_PITCH, half, tool),
  ).join("");
  const kinds = Object.entries(CARD_KINDS)
    .map(([kind, cards], index) =>
      chip(
        MARGIN + half + COLUMN_GAP,
        FIRST_ROW_Y + index * CHIP_PITCH,
        half,
        `${kind}: ${String(cards.length)} cards`,
      ),
    )
    .join("");
  return surface(
    `${svgText(MARGIN, TITLE_Y, "Tools", "svg-text svg-strong")}${svgText(MARGIN + half + COLUMN_GAP, TITLE_Y, "Knowledge cards", "svg-text svg-strong")}${tools}${kinds}`,
  );
}

/** Plane 4: E1 in the graph, then the six E2 detectors. */
export function verifiersSurface(): string {
  const half = (WIDTH - MARGIN * 2 - COLUMN_GAP) / 2;
  const e1 = [
    chip(MARGIN, FIRST_ROW_Y, half, "E1 static rules", "svg-chip--pass"),
    chip(MARGIN, FIRST_ROW_Y + CHIP_PITCH, half, "cites card:line"),
    chip(MARGIN, FIRST_ROW_Y + CHIP_PITCH * 2, half, "runs every attempt"),
  ].join("");
  const e2 = DETECTOR_ORDER.map((detector, index) =>
    chip(
      MARGIN + half + COLUMN_GAP,
      FIRST_ROW_Y + index * CHIP_PITCH,
      half,
      detector,
      "svg-chip--trip",
    ),
  ).join("");
  return surface(
    `${svgText(MARGIN, TITLE_Y, "E1 · source", "svg-text svg-strong")}${svgText(MARGIN + half + COLUMN_GAP, TITLE_Y, "E2 · Chromium", "svg-text svg-strong")}${e1}${e2}`,
  );
}

/** Plane 5: the gap the harness exists to show, E1 against E2. */
export function harnessSurface(report: Report): string {
  const facts = headlineFacts(report);
  const track = WIDTH - MARGIN * 2;
  const rows = [
    {
      label: `E1 ${formatScore(facts.e1Min)} on ${formatCount(facts.e1Perfect, facts.items)}`,
      share: barShare(facts.e1Perfect, facts.items),
      tone: "svg-pass",
    },
    {
      label: `E2 passed ${formatCount(facts.e2Passed, facts.e2Probed)}`,
      share: barShare(facts.e2Passed, facts.e2Probed),
      tone: "svg-trip",
    },
  ];
  const bars = rows
    .map((row, index) => {
      const y = FIRST_ROW_Y + index * (BAR_HEIGHT + CHIP_PITCH);
      return `${svgText(MARGIN, y, row.label, "svg-text")}${svgRect(MARGIN, y + CHIP_TEXT_X, track, BAR_HEIGHT, "svg-track", CHIP_RADIUS)}${svgRect(MARGIN, y + CHIP_TEXT_X, track * row.share, BAR_HEIGHT, row.tone, CHIP_RADIUS)}`;
    })
    .join("");
  return surface(
    `${svgText(MARGIN, TITLE_Y, "Same games, two tiers", "svg-text svg-strong")}${bars}`,
  );
}
