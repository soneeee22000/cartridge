import { CARTRIDGE_HELPER } from "../contract/bridge.ts";
import type { GameSpec } from "../contract/spec.ts";

/** The plan the demo mock planner returns. */
export const MOCK_SPEC: GameSpec = {
  title: "Lantern Dash",
  slug: "lantern-dash",
  lang: "en",
  gameType: "arcade-run",
  loop: "A paper lantern drifts up a night street; tap to hop between two lanes, dodge falling tiles and collect sparks.",
  input: "tap-anywhere",
  style: "paper-cut",
};

const GAME_SCRIPT = `
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const LANES = 2;
const TILE_SPEED = 3;
let lane = 0, score = 0, playing = false, paused = false, tiles = [], tick = 0;
function fit() { canvas.width = innerWidth; canvas.height = innerHeight; }
function laneX(index) { return (canvas.width / LANES) * (index + 0.5); }
function begin() {
  if (playing) return;
  playing = true; score = 0; tiles = []; tick = 0;
  CARTRIDGE.send("start");
}
function backToTitle() { playing = false; tiles = []; score = 0; }
function hop() { if (!playing) { begin(); return; } lane = (lane + 1) % LANES; }
function crash() { playing = false; CARTRIDGE.send("end", { reason: "lose", value: score }); }
function step() {
  tick += 1;
  if (tick % 45 === 0) tiles.push({ lane: tick % LANES, y: -20 });
  for (const tile of tiles) tile.y += TILE_SPEED;
  const player = canvas.height - 60;
  if (tiles.some((tile) => tile.lane === lane && Math.abs(tile.y - player) < 20)) { crash(); return; }
  const before = tiles.length;
  tiles = tiles.filter((tile) => tile.y < canvas.height);
  if (tiles.length < before) { score += 1; CARTRIDGE.send("score", { value: score }); }
}
function draw() {
  ctx.fillStyle = "#f4ead5"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#2f4858";
  for (const tile of tiles) ctx.fillRect(laneX(tile.lane) - 18, tile.y - 18, 36, 36);
  ctx.fillStyle = "#e07a5f";
  ctx.beginPath(); ctx.arc(laneX(lane), canvas.height - 60, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3d405b"; ctx.font = "20px sans-serif";
  ctx.fillText(playing ? "Sparks: " + score : "Tap to fly", 16, 32);
}
function frame() { if (playing && !paused) step(); draw(); requestAnimationFrame(frame); }
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "cartridge-host") return;
  if (data.type === "pause") paused = true;
  if (data.type === "resume") paused = false;
  if (data.type === "reset") backToTitle();
});
canvas.addEventListener("pointerdown", hop);
addEventListener("resize", fit);
fit();
draw();
CARTRIDGE.send("boot", { title: "Lantern Dash", gameType: "arcade-run", lang: "en" });
requestAnimationFrame(frame);
`;

/** A small, complete arcade-run page that passes every hard E1 rule; the mock builder saves it. */
export const MOCK_GAME_HTML = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>Lantern Dash</title>",
  "<style>html, body { margin: 0; height: 100dvh; overflow: hidden; } canvas { display: block; }</style>",
  "</head>",
  "<body>",
  '<canvas id="stage"></canvas>',
  `<script>\n${CARTRIDGE_HELPER}\n${GAME_SCRIPT}</script>`,
  "</body>",
  "</html>",
].join("\n");
