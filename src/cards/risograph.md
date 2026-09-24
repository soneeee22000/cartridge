---
id: risograph
kind: style
title: Risograph
summary: Two-ink print look with visible grain and slightly misaligned layers.
related: [game-page]
---

# Risograph

The screen looks like a cheap two-colour print: flat ink, grain and a little misregistration.

## Palette

| role    | colour    |
| ------- | --------- |
| paper   | `#fbf7ee` |
| ink one | `#ff48b0` |
| ink two | `#0078bf` |
| overlap | `#5b3a8c` |

## Primitives

- Flat fills in one ink per shape; where the two inks overlap, use the overlap colour.
- Offset the second ink layer by one or two pixels to fake misregistration.
- A grain pass: a pre-rendered noise tile drawn with `globalAlpha` around 0.08 over the whole frame.
- Bold, condensed system type in one ink.

## Avoid

- More than the four colours above.
- Smooth gradients; use halftone dots if a shade is needed.
- Re-rendering the grain every frame; draw the tile once and reuse it.
