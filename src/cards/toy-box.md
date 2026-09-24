---
id: toy-box
kind: type
title: Toy box
summary: Open play with a visible tally and a clear-the-table replay; nobody loses.
related: [bridge, drag-follow, game-page, tap-anywhere]
---

# Toy box

A toy, not a contest. The player places, pops or arranges things and watches a tally grow. There is no losing and no final screen.

## Contract row

| field                | value       |
| -------------------- | ----------- |
| score                | `optional`  |
| level                | `forbidden` |
| end                  | `forbidden` |
| end reasons          | `none`      |
| reset                | `hard`      |
| idle death gate      | `any-end`   |
| idle motion required | `no`        |

- Emit every event marked `required` above. A toy box has none beyond `boot` and `start`, and it sends `start` straight away. <!-- rule:E1-15 -->
- Never emit `level` or `end`. <!-- rule:E1-16 -->
- No `end` reason is allowed, because `end` is never sent. <!-- rule:E1-17 -->

## Clear-the-table replay

Replay means clearing the table. Write one function that empties the table and zeroes the tally, call it from the host `reset` command, and call the same function from a visible in-game control. <!-- rule:E1-24 -->

```js
function clearTable() {
  pieces.length = 0;
  tally = 0;
  CARTRIDGE.send("score", { value: 0 });
  draw();
}
clearButton.addEventListener("click", clearTable);
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "cartridge-host") return;
  if (data.type === "reset") clearTable();
});
```

Keep the clear control visible at all times and at least 44 CSS pixels tall.

## Loop skeleton

```js
const pieces = [];
let tally = 0,
  paused = false;
function place(x, y) {
  pieces.push({ x, y });
  tally += 1;
  CARTRIDGE.send("score", { value: tally });
}
function frame() {
  if (!paused) settle(pieces);
  draw();
  requestAnimationFrame(frame);
}
CARTRIDGE.send("start");
requestAnimationFrame(frame);
```
