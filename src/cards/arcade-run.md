---
id: arcade-run
kind: type
title: Arcade run
summary: A continuous run with one life where the player survives and collects.
related: [bridge, game-page, swipe-lanes, tap-anywhere]
---

# Arcade run

The world scrolls on its own, the player dodges and gathers, and one mistake ends the run.

## Contract row

| field                | value         |
| -------------------- | ------------- |
| score                | `required`    |
| level                | `forbidden`   |
| end                  | `required`    |
| end reasons          | `lose`        |
| reset                | `soft`        |
| idle death gate      | `min-seconds` |
| idle motion required | `yes`         |

- Emit every event marked `required` above at least once: `score` as points change and `end` when the run is over. <!-- rule:E1-15 -->
- Never emit an event marked `forbidden`. A run has no levels, so ramp difficulty with speed instead. <!-- rule:E1-16 -->
- The only allowed `end` reason is `lose`. <!-- rule:E1-17 -->

## Fairness

A player who does nothing must survive for a few seconds after `start`. Spawn the first hazard well ahead of the player and keep the opening lane clear.

## Loop skeleton

```js
let last = 0,
  running = false,
  paused = false,
  score = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (running && !paused) {
    advance(dt);
    collide();
  }
  draw();
  requestAnimationFrame(frame);
}
function crash() {
  running = false;
  CARTRIDGE.send("end", { reason: "lose", value: score });
}
```

Keep something moving on screen while idle (clouds, a pulsing prompt) so the run never looks frozen.
