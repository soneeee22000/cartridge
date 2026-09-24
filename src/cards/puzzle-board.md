---
id: puzzle-board
kind: type
title: Puzzle board
summary: A turn-based board with no clock pressure, won by solving it.
related: [bridge, drag-follow, game-page, tap-anywhere]
---

# Puzzle board

The board only changes when the player acts. Nothing happens while the player thinks.

## Contract row

| field                | value        |
| -------------------- | ------------ |
| score                | `required`   |
| level                | `optional`   |
| end                  | `required`   |
| end reasons          | `win, stuck` |
| reset                | `soft`       |
| idle death gate      | `any-end`    |
| idle motion required | `no`         |

- Emit every event marked `required` above: `score` after each scoring move and `end` when the board is solved or has no legal move left. <!-- rule:E1-15 -->
- Never emit an event marked `forbidden` in the row above. <!-- rule:E1-16 -->
- End with `win` when solved or `stuck` when no move remains. <!-- rule:E1-17 -->

## No clock

Never end the game on a timer. A player who waits forever must never see `end`. A still board between moves is correct.

## Loop skeleton

```js
let moves = 0;
function onCellTapped(cell) {
  if (!isLegal(cell)) return;
  apply(cell);
  moves += 1;
  CARTRIDGE.send("score", { value: points() });
  if (solved()) CARTRIDGE.send("end", { reason: "win", value: moves });
  else if (!anyLegalMove()) CARTRIDGE.send("end", { reason: "stuck" });
  draw();
}
```

Redraw on input and on resize; a continuous animation loop is optional.
