---
id: drag-follow
kind: input
title: Drag follow
summary: A piece follows the finger or cursor while it is held down.
related: [puzzle-board, stage-clear, toy-box]
---

# Drag follow

The player presses on a piece and it trails the pointer until release. Good for steering, sorting and placing.

- Register `pointerdown`, `pointermove` and `pointerup` on the canvas and capture the pointer on press. <!-- rule:E1-22 -->
- Convert client coordinates to canvas coordinates with `getBoundingClientRect()` and the device pixel ratio.
- Ease towards the target instead of snapping, so small jitters do not shake the piece.

```js
let held = null;
canvas.addEventListener("pointerdown", (event) => {
  held = pieceAt(toCanvas(event));
  if (held) canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (held) held.target = toCanvas(event);
});
canvas.addEventListener("pointerup", () => {
  held = null;
});
```

Drop the piece on `pointercancel` as well, so a system gesture never leaves it stuck to the finger.
