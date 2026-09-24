---
id: chalkboard
kind: style
title: Chalkboard
summary: Dusty hand-drawn strokes on a dark slate.
related: [game-page]
---

# Chalkboard

The game looks sketched in chalk on a school slate.

## Palette

| role   | colour    |
| ------ | --------- |
| slate  | `#2f3e3a` |
| chalk  | `#eeeae0` |
| accent | `#f2c14e` |
| second | `#8fc1e3` |

## Primitives

- Stroked paths with `lineCap = "round"` and a line width of 3 to 5 pixels.
- Draw each stroke twice with a one-pixel offset and lower alpha for a dusty edge.
- Hatching (parallel short lines) instead of solid fills.
- A faint smudge layer: a few large, very transparent chalk-coloured ellipses behind the play field.

## Avoid

- Solid filled shapes larger than a thumb.
- Perfectly straight machine lines; add a small wobble.
- More than two accent colours on screen at once.
