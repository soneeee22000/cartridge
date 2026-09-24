---
id: stage-clear
kind: type
title: Stage clear
summary: Discrete stages, each with one goal to meet before moving on.
related: [bridge, drag-follow, game-page, tap-anywhere]
---

# Stage clear

The player meets a stated goal to clear each stage. Clearing the last stage wins; failing a stage loses.

## Contract row

| field                | value         |
| -------------------- | ------------- |
| score                | `optional`    |
| level                | `required`    |
| end                  | `required`    |
| end reasons          | `win, lose`   |
| reset                | `soft`        |
| idle death gate      | `min-seconds` |
| idle motion required | `yes`         |

- Emit every event marked `required` above: a `level` on entering each stage and an `end` when the play-through finishes. <!-- rule:E1-15 -->
- Never emit an event marked `forbidden` in the row above. <!-- rule:E1-16 -->
- Use only `win` or `lose` as the `end` reason. <!-- rule:E1-17 -->

## Stages

Number stages from 1 and step by one. Show the goal on screen when each stage opens ("Light 5 lamps"). Make stage 1 easy enough to clear on the first try.

## Loop skeleton

```js
let stage = 0;
function enterStage(next) {
  stage = next;
  buildStage(stage);
  CARTRIDGE.send("level", { index: stage });
}
function onGoalMet() {
  if (stage === STAGES.length) CARTRIDGE.send("end", { reason: "win" });
  else enterStage(stage + 1);
}
function onStageFailed() {
  CARTRIDGE.send("end", { reason: "lose" });
}
```

Give the player a few seconds of grace at the start of each stage before any threat can finish it.
