---
id: paper-cut
kind: style
title: Paper cut
summary: Layered flat shapes with soft drop shadows, like cut card stock.
related: [game-page]
---

# Paper cut

Everything looks cut from coloured card and stacked in layers.

## Palette

| role       | colour    |
| ---------- | --------- |
| background | `#f4ecd8` |
| layer      | `#e07a5f` |
| accent     | `#3d405b` |
| highlight  | `#81b29a` |

## Primitives

- Filled paths with slightly irregular edges: jitter each vertex by one or two pixels, seeded once so it does not flicker.
- One soft shadow per layer: `shadowBlur` around 6 and a small downward offset.
- Rounded rectangles and circles for pieces; stacked copies offset by a few pixels suggest depth.
- Text in a heavy system sans-serif, drawn on a card-shaped plate.

## Avoid

- Gradients, glows and outlines thicker than two pixels.
- Pure black; use the accent colour for the darkest tone.
- Photographic textures or anything loaded from a file.
