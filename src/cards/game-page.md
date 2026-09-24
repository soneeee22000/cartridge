---
id: game-page
kind: contract
title: Game page
summary: The shape of the single HTML file every cartridge ships as.
related: [bridge]
---

# Game page

A cartridge is one self-contained HTML file. The host loads it into a sandboxed iframe with scripts allowed and no same-origin access.

## Document

- Start with a single `<!doctype html>` and wrap everything in one `<html>…</html>`. Never embed another `<iframe>`. <!-- rule:E1-01 -->
- Put the UI language on the root element, for example `<html lang="fr">`: a two- or three-letter primary subtag with an optional region. <!-- rule:E1-03 -->
- Add `<meta name="viewport" content="width=device-width, initial-scale=1">` in the head. <!-- rule:E1-04 -->

## Self-contained

- Load nothing from outside the file: no `http:`, `https:` or `//` URL in `src`, `href`, CSS `url()`, `@import` or `import()`. Inline `data:` URIs are fine. <!-- rule:E1-02 -->
- Draw every sprite, tile and glyph in code (canvas paths or inline SVG). Use system fonts.

## Forbidden APIs

- Do not open a network connection: no `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon`. <!-- rule:E1-05 -->
- Do not persist anything: `localStorage`, `sessionStorage`, `indexedDB` and `document.cookie` all throw inside the sandbox. <!-- rule:E1-06 -->
- Do not build code at runtime: no `eval(`, no `new Function(`, and pass functions, not strings, to `setTimeout` and `setInterval`. <!-- rule:E1-07 -->
- Avoid blocking dialogs (`alert(`, `confirm(`, `prompt(`); draw messages on the canvas instead. <!-- rule:E1-08 -->

## Scripts

- Use classic inline `<script>` blocks only, never `type="module"`, and make sure each one parses on its own. <!-- rule:E1-09 -->
- Keep one script for the bridge helper and one for the game, or merge them. Order matters: the helper must exist first.

## Layout

- Fill the viewport and react when it changes: listen for `resize`, read `innerWidth`/`innerHeight`, or size with `dvh`/`vw` units. <!-- rule:E1-23 -->
- Scale the canvas by `devicePixelRatio` so lines stay crisp on phones.
- Keep touch targets at least 44 CSS pixels on the short edge.
