---
id: swipe-lanes
kind: input
title: Swipe lanes
summary: Short swipes move the player between a fixed number of lanes.
related: [arcade-run, stage-clear]
---

# Swipe lanes

The play field has three or four lanes. A swipe left or right moves one lane; a tap does nothing, or performs a secondary action.

- Register `pointerdown` and `pointerup`, measure the horizontal distance and compare it with a minimum swipe length. <!-- rule:E1-22 -->
- Choose the minimum swipe length as a fraction of the canvas width, not in fixed pixels.
- Clamp the lane index so the player never leaves the field.

```js
const SWIPE_FRACTION = 0.08;
let pressX = 0;
canvas.addEventListener("pointerdown", (event) => {
  pressX = event.clientX;
});
canvas.addEventListener("pointerup", (event) => {
  const dx = event.clientX - pressX;
  if (Math.abs(dx) < canvas.clientWidth * SWIPE_FRACTION) return;
  lane = Math.max(0, Math.min(LANES - 1, lane + Math.sign(dx)));
});
```

Also accept the left and right arrow keys so the game can be tried on a desktop.
