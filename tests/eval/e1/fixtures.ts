import { CARTRIDGE_HELPER } from "../../../src/contract/bridge.ts";
import type { GameType } from "../../../src/contract/game-types.ts";

export interface GameParts {
  readonly doctype?: string;
  readonly htmlOpen?: string;
  readonly viewport?: string;
  readonly style?: string;
  readonly body?: string;
  readonly helper?: string;
  readonly boot?: string;
  readonly start?: string;
  readonly typed?: string;
  readonly host?: string;
  readonly input?: string;
  readonly layout?: string;
  readonly extra?: string;
  readonly extraScripts?: string;
}

const TYPED_CALLS: Readonly<Record<GameType, string>> = {
  "arcade-run": [
    'function gain() { score += 1; CARTRIDGE.send("score", { value: score }); }',
    'function crash() { CARTRIDGE.send("end", { reason: "lose", value: score }); }',
  ].join("\n"),
  "stage-clear": [
    'function enter(stage) { CARTRIDGE.send("level", { index: stage }); }',
    'function finish(won) { CARTRIDGE.send("end", { reason: won ? "win" : "lose" }); }',
    'function lost() { CARTRIDGE.send("end", { reason: "lose" }); }',
  ].join("\n"),
  "puzzle-board": [
    'function moved() { CARTRIDGE.send("score", { value: score }); }',
    'function solved() { CARTRIDGE.send("end", { reason: "win" }); }',
    'function blocked() { CARTRIDGE.send("end", { reason: "stuck" }); }',
  ].join("\n"),
  "toy-box":
    'function placed() { score += 1; CARTRIDGE.send("score", { value: score }); }',
};

export const HOST_HANDLER = (resetCall: string): string =>
  [
    'window.addEventListener("message", (event) => {',
    "  const data = event.data;",
    '  if (!data || data.source !== "cartridge-host") return;',
    '  if (data.type === "pause") paused = true;',
    '  if (data.type === "resume") paused = false;',
    `  if (data.type === "reset") ${resetCall};`,
    "});",
  ].join("\n");

export const TOY_BOX_CONTROL = [
  "function clearTable() { score = 0; }",
  'document.getElementById("clear").addEventListener("click", clearTable);',
].join("\n");

function defaults(gameType: GameType): Required<GameParts> {
  const isToyBox = gameType === "toy-box";
  return {
    doctype: "<!doctype html>",
    htmlOpen: '<html lang="en">',
    viewport:
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    style: "<style>html, body { margin: 0; }</style>",
    body: isToyBox
      ? '<canvas id="stage"></canvas><button id="clear">Clear</button>'
      : '<canvas id="stage"></canvas>',
    helper: CARTRIDGE_HELPER,
    boot: `CARTRIDGE.send("boot", { title: "Kite Rush", gameType: "${gameType}", lang: "en" });`,
    start:
      'canvas.addEventListener("pointerdown", () => { CARTRIDGE.send("start"); });',
    typed: TYPED_CALLS[gameType],
    host: HOST_HANDLER(isToyBox ? "clearTable()" : "backToTitle()"),
    input: "",
    layout:
      'function fit() { canvas.width = innerWidth; } addEventListener("resize", fit);',
    extra: isToyBox ? TOY_BOX_CONTROL : "function backToTitle() { score = 0; }",
    extraScripts: "",
  };
}

/**
 * Builds a minimal game page that passes every E1 rule for its type, then applies overrides.
 * @param gameType declared game type
 * @param parts overrides for individual parts of the page
 */
export function game(
  gameType: GameType = "arcade-run",
  parts: GameParts = {},
): string {
  const merged = { ...defaults(gameType), ...parts };
  return [
    merged.doctype,
    merged.htmlOpen,
    `<head><meta charset="utf-8">${merged.viewport}<title>Kite Rush</title>${merged.style}</head>`,
    `<body>${merged.body}`,
    `<script>\n${merged.helper}\n</script>`,
    "<script>",
    'const canvas = document.getElementById("stage");',
    "let score = 0, paused = false;",
    merged.layout,
    merged.extra,
    merged.host,
    merged.input,
    merged.start,
    merged.boot,
    merged.typed,
    "</script>",
    merged.extraScripts,
    "</body>",
    "</html>",
  ].join("\n");
}
