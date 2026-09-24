---
id: bridge
kind: contract
title: Bridge
summary: The postMessage protocol between a game and its host page.
related: [game-page]
---

# Bridge

Games talk to the host only through `postMessage`. Paste this helper verbatim before any game code:

```js
const CARTRIDGE = {
  send(type, payload = {}) {
    window.parent.postMessage(
      { source: "cartridge", v: 1, type, payload },
      "*",
    );
  },
};
```

The helper must be named `CARTRIDGE` and must stamp `source: "cartridge"` and `v: 1` on every message. <!-- rule:E1-10 -->

## Game to host

| event   | payload                              | when                                 |
| ------- | ------------------------------------ | ------------------------------------ |
| `boot`  | `{ title, gameType, lang }`          | once, after the first frame is drawn |
| `start` | `{}`                                 | when play begins                     |
| `score` | `{ value }`, an integer of 0 or more | whenever the score changes           |
| `level` | `{ index }`, starting at 1, then +1  | on entering each level               |
| `end`   | `{ reason, value? }`                 | once per play-through                |

- Send `boot` with all three keys: `CARTRIDGE.send("boot", { title, gameType, lang })`. <!-- rule:E1-11 -->
- When `boot.lang` is written as a literal, it must equal the `lang` on `<html>`. <!-- rule:E1-12 -->
- Emit `CARTRIDGE.send("start")` when play begins. <!-- rule:E1-13 -->
- Write `boot.gameType` as a string literal naming one of the four game types; it must match the planned type. <!-- rule:E1-14 -->
- Pass `score.value` as a number, never a quoted string. <!-- rule:E1-18 -->
- Give every `level` call an `index` key: `CARTRIDGE.send("level", { index: stage })`. <!-- rule:E1-19 -->

## Host to game

Commands arrive as `{ source: "cartridge-host", type }` with `type` one of `pause`, `resume` or `reset`. Ignore anything with another `source`.

- Listen with `window.addEventListener("message", …)` and handle `pause` and `resume`: freeze and restart the loop without losing state. <!-- rule:E1-20 -->
- Handle `reset` by returning to the pre-`start` screen without reloading the page. <!-- rule:E1-21 -->

```js
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "cartridge-host") return;
  if (data.type === "pause") paused = true;
  if (data.type === "resume") paused = false;
  if (data.type === "reset") backToTitle();
});
```
