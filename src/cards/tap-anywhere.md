---
id: tap-anywhere
kind: input
title: Tap anywhere
summary: One action bound to a tap or click on any part of the screen.
related: [arcade-run, puzzle-board, stage-clear]
---

# Tap anywhere

The whole screen is the button. Best for jumps, flaps and single choices.

- Register pointer input on the canvas: `canvas.addEventListener("pointerdown", onTap)`. <!-- rule:E1-22 -->
- Call `event.preventDefault()` and set `touch-action: none` on the canvas so the page does not scroll or zoom.
- The first tap after `boot` starts play and sends `start`; later taps perform the action.
- Ignore taps while paused.

```js
canvas.style.touchAction = "none";
canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (paused) return;
  if (!running) {
    running = true;
    CARTRIDGE.send("start");
    return;
  }
  act();
});
```

Show a short pulsing hint ("Tap to begin") until the first tap.
