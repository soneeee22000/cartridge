import { describe, expect, it } from "vitest";
import type { GameSpec } from "../../../src/contract/spec.ts";
import { evaluateRule } from "../../../src/eval/e1/score.ts";
import { HOST_HANDLER, TOY_BOX_CONTROL, game } from "./fixtures.ts";

type Status = "pass" | "fail" | "n/a";

function status(ruleId: string, html: string, spec?: GameSpec): Status {
  return evaluateRule(ruleId, html, spec ? { spec } : {}).status;
}

const SPEC: GameSpec = {
  title: "Kite Rush",
  slug: "kite-rush",
  lang: "en",
  gameType: "arcade-run",
  loop: "Steer a kite past gusts and collect ribbons.",
  input: "swipe-lanes",
  style: "paper-cut",
};

describe("baseline fixtures", () => {
  it.each(["arcade-run", "stage-clear", "puzzle-board", "toy-box"] as const)(
    "%s passes or skips every rule",
    (gameType) => {
      const html = game(gameType);
      for (let number = 1; number <= 24; number += 1) {
        const ruleId = `E1-${String(number).padStart(2, "0")}`;
        expect([ruleId, status(ruleId, html)]).not.toEqual([ruleId, "fail"]);
      }
    },
  );
});

describe("E1-01 document shape", () => {
  it("passes a single document", () => {
    expect(status("E1-01", game())).toBe("pass");
  });
  it("fails a second doctype", () => {
    expect(
      status(
        "E1-01",
        game("arcade-run", { doctype: "<!doctype html><!DOCTYPE html>" }),
      ),
    ).toBe("fail");
  });
  it("fails a nested iframe", () => {
    expect(
      status(
        "E1-01",
        game("arcade-run", { body: '<iframe src="about:blank"></iframe>' }),
      ),
    ).toBe("fail");
  });
  it("ignores an iframe inside an HTML comment", () => {
    expect(
      status(
        "E1-01",
        game("arcade-run", {
          body: '<canvas id="stage"></canvas><!-- <iframe> -->',
        }),
      ),
    ).toBe("pass");
  });
});

describe("E1-02 external references", () => {
  it("allows data URIs and URL-looking canvas text", () => {
    const html = game("arcade-run", {
      body: '<canvas id="stage"></canvas><img src="data:image/png;base64,AAAA">',
      extraScripts:
        '<script>ctx.fillText("see https://example.test", 1, 1);</script>',
    });
    expect(status("E1-02", html)).toBe("pass");
  });
  it.each([
    ["an https src", { body: '<img src="https://example.test/a.png">' }],
    [
      "a protocol-relative href",
      { body: '<link rel="stylesheet" href="//cdn.example.test/a.css">' },
    ],
    [
      "a css url()",
      {
        style:
          "<style>body { background: url(http://example.test/b.png); }</style>",
      },
    ],
    [
      "a css @import",
      { style: '<style>@import "https://example.test/c.css";</style>' },
    ],
    [
      "a dynamic import",
      { extraScripts: '<script>import("https://example.test/m.js");</script>' },
    ],
    [
      "a script-assigned src",
      {
        extraScripts:
          '<script>img.src = "https://example.test/d.png";</script>',
      },
    ],
  ])("fails %s", (_label, parts) => {
    expect(status("E1-02", game("arcade-run", parts))).toBe("fail");
  });
});

describe("E1-03 html lang", () => {
  it("passes a language with a region", () => {
    expect(
      status("E1-03", game("arcade-run", { htmlOpen: '<html lang="fr-CA">' })),
    ).toBe("pass");
  });
  it("fails a missing lang", () => {
    expect(status("E1-03", game("arcade-run", { htmlOpen: "<html>" }))).toBe(
      "fail",
    );
  });
  it("fails a malformed lang", () => {
    expect(
      status(
        "E1-03",
        game("arcade-run", { htmlOpen: '<html lang="english">' }),
      ),
    ).toBe("fail");
  });
});

describe("E1-04 viewport", () => {
  it("passes with width=device-width", () => {
    expect(status("E1-04", game())).toBe("pass");
  });
  it("fails without a viewport meta", () => {
    expect(status("E1-04", game("arcade-run", { viewport: "" }))).toBe("fail");
  });
});

describe("E1-05 to E1-08 forbidden APIs", () => {
  it.each([
    ["E1-05", 'fetch("/scores");'],
    ["E1-05", "const socket = new WebSocket(address);"],
    ["E1-05", "navigator.sendBeacon(address, data);"],
    ["E1-06", 'localStorage.setItem("best", 1);'],
    ["E1-06", 'document.cookie = "a=1";'],
    ["E1-07", 'eval("1 + 1");'],
    ["E1-07", 'const make = new Function("return 1");'],
    ["E1-07", 'setTimeout("tick()", 10);'],
    ["E1-08", 'alert("Game over");'],
    ["E1-08", 'window.confirm("Again?");'],
  ])("%s fails on %s", (ruleId, code) => {
    expect(
      status(
        ruleId,
        game("arcade-run", { extraScripts: `<script>${code}</script>` }),
      ),
    ).toBe("fail");
  });

  it.each([
    ["E1-05", '// fetch("/scores")\nconst label = "fetch(later)";'],
    ["E1-06", 'const hint = "no localStorage here";'],
    ["E1-07", "setTimeout(tick, 10); setInterval(() => tick(), 10);"],
    ["E1-08", 'dialog.prompt("name"); const words = "alert(";'],
  ])("%s passes on %s", (ruleId, code) => {
    expect(
      status(
        ruleId,
        game("arcade-run", { extraScripts: `<script>${code}</script>` }),
      ),
    ).toBe("pass");
  });
});

describe("E1-09 classic scripts that compile", () => {
  it("passes classic scripts and skips data blocks", () => {
    expect(
      status(
        "E1-09",
        game("arcade-run", {
          extraScripts: '<script type="application/json">{"a": </script>',
        }),
      ),
    ).toBe("pass");
  });
  it("fails a module script", () => {
    expect(
      status(
        "E1-09",
        game("arcade-run", {
          extraScripts: '<script type="module">let a = 1;</script>',
        }),
      ),
    ).toBe("fail");
  });
  it("fails a syntax error", () => {
    expect(
      status(
        "E1-09",
        game("arcade-run", { extraScripts: "<script>function (</script>" }),
      ),
    ).toBe("fail");
  });
});

describe("E1-10 helper", () => {
  it("passes the canonical helper", () => {
    expect(status("E1-10", game())).toBe("pass");
  });
  it("fails when the helper is missing", () => {
    expect(status("E1-10", game("arcade-run", { helper: "" }))).toBe("fail");
  });
  it("fails the wrong source or version", () => {
    const wrongSource = game("arcade-run", {
      helper:
        'const CARTRIDGE = { send(type, payload = {}) { parent.postMessage({ source: "cart", v: 1, type, payload }, "*"); } };',
    });
    const wrongVersion = game("arcade-run", {
      helper:
        'const CARTRIDGE = { send(type, payload = {}) { parent.postMessage({ source: "cartridge", v: 2, type, payload }, "*"); } };',
    });
    expect(status("E1-10", wrongSource)).toBe("fail");
    expect(status("E1-10", wrongVersion)).toBe("fail");
  });
});

describe("E1-11 to E1-14 boot and start", () => {
  it("E1-11 fails without boot or without the lang key", () => {
    expect(status("E1-11", game("arcade-run", { boot: "" }))).toBe("fail");
    expect(
      status(
        "E1-11",
        game("arcade-run", {
          boot: 'CARTRIDGE.send("boot", { title: "A", gameType: "arcade-run" });',
        }),
      ),
    ).toBe("fail");
  });
  it("E1-11 passes shorthand keys", () => {
    expect(
      status(
        "E1-11",
        game("arcade-run", {
          boot: 'CARTRIDGE.send("boot", { title, gameType: "arcade-run", lang });',
        }),
      ),
    ).toBe("pass");
  });
  it("E1-12 compares a literal boot lang with html lang", () => {
    expect(status("E1-12", game())).toBe("pass");
    const mismatch =
      'CARTRIDGE.send("boot", { title: "A", gameType: "arcade-run", lang: "fr" });';
    expect(status("E1-12", game("arcade-run", { boot: mismatch }))).toBe(
      "fail",
    );
    const computed =
      'CARTRIDGE.send("boot", { title: "A", gameType: "arcade-run", lang: document.documentElement.lang });';
    expect(status("E1-12", game("arcade-run", { boot: computed }))).toBe("n/a");
  });
  it("E1-13 fails without start", () => {
    expect(status("E1-13", game())).toBe("pass");
    expect(status("E1-13", game("arcade-run", { start: "" }))).toBe("fail");
  });
  it("E1-14 checks the game type literal and the spec", () => {
    expect(status("E1-14", game(), SPEC)).toBe("pass");
    const unknown =
      'CARTRIDGE.send("boot", { title: "A", gameType: "free-play", lang: "en" });';
    const computed =
      'CARTRIDGE.send("boot", { title: "A", gameType: kind, lang: "en" });';
    expect(status("E1-14", game("arcade-run", { boot: unknown }))).toBe("fail");
    expect(status("E1-14", game("arcade-run", { boot: computed }))).toBe(
      "fail",
    );
    expect(status("E1-14", game(), { ...SPEC, gameType: "puzzle-board" })).toBe(
      "fail",
    );
  });
});

describe("E1-15 to E1-17 type rules", () => {
  it("E1-15 fails when a required event is missing", () => {
    expect(status("E1-15", game())).toBe("pass");
    const noScore =
      'function crash() { CARTRIDGE.send("end", { reason: "lose" }); }';
    expect(status("E1-15", game("arcade-run", { typed: noScore }))).toBe(
      "fail",
    );
  });
  it("E1-15 is n/a without a known type", () => {
    const unknown =
      'CARTRIDGE.send("boot", { title: "A", gameType: "free-play", lang: "en" });';
    expect(status("E1-15", game("arcade-run", { boot: unknown }))).toBe("n/a");
  });
  it("E1-16 fails when a forbidden event is present", () => {
    expect(status("E1-16", game("toy-box"))).toBe("pass");
    const withLevel = `${game("arcade-run").split("</body>")[0] ?? ""}<script>CARTRIDGE.send("level", { index: 1 });</script></body></html>`;
    expect(status("E1-16", withLevel)).toBe("fail");
  });
  it("E1-17 fails a reason outside the allowed set", () => {
    expect(status("E1-17", game("puzzle-board"))).toBe("pass");
    const wrong =
      'function crash() { CARTRIDGE.send("score", { value: 1 }); CARTRIDGE.send("end", { reason: "win" }); }';
    expect(status("E1-17", game("arcade-run", { typed: wrong }))).toBe("fail");
    expect(status("E1-17", game("toy-box"))).toBe("n/a");
  });
  it("uses the spec type over the boot literal", () => {
    expect(
      status("E1-15", game("stage-clear"), {
        ...SPEC,
        gameType: "stage-clear",
      }),
    ).toBe("pass");
    expect(
      status("E1-15", game("toy-box"), { ...SPEC, gameType: "arcade-run" }),
    ).toBe("fail");
  });
});

describe("E1-18 and E1-19 payload shapes", () => {
  it("E1-18 fails a quoted score", () => {
    expect(status("E1-18", game())).toBe("pass");
    const quoted =
      'function gain() { CARTRIDGE.send("score", { value: "10" }); CARTRIDGE.send("end", { reason: "lose" }); }';
    expect(status("E1-18", game("arcade-run", { typed: quoted }))).toBe("fail");
    expect(status("E1-18", game("stage-clear"))).toBe("n/a");
  });
  it("E1-19 fails a level call without index", () => {
    expect(status("E1-19", game("stage-clear"))).toBe("pass");
    const noIndex =
      'function enter(stage) { CARTRIDGE.send("level", { stage }); CARTRIDGE.send("end", { reason: "win" }); }';
    expect(status("E1-19", game("stage-clear", { typed: noIndex }))).toBe(
      "fail",
    );
    expect(status("E1-19", game())).toBe("n/a");
  });
});

describe("E1-20 and E1-21 host commands", () => {
  it("E1-20 fails when resume is not handled", () => {
    expect(status("E1-20", game())).toBe("pass");
    const noResume = HOST_HANDLER("backToTitle()").replace(
      '"resume"',
      '"unpause"',
    );
    expect(status("E1-20", game("arcade-run", { host: noResume }))).toBe(
      "fail",
    );
    expect(status("E1-20", game("arcade-run", { host: "" }))).toBe("fail");
  });
  it("E1-21 fails when reset is not handled and is n/a for toy-box", () => {
    expect(status("E1-21", game())).toBe("pass");
    const noReset = HOST_HANDLER("backToTitle()").replace(
      '"reset"',
      '"restart"',
    );
    expect(status("E1-21", game("arcade-run", { host: noReset }))).toBe("fail");
    expect(status("E1-21", game("toy-box"))).toBe("n/a");
  });
});

describe("E1-22 pointer input", () => {
  it("passes a pointer listener and a touch property", () => {
    expect(status("E1-22", game())).toBe("pass");
    expect(
      status(
        "E1-22",
        game("arcade-run", { start: "canvas.ontouchstart = begin;" }),
      ),
    ).toBe("pass");
  });
  it("fails with no pointer input", () => {
    expect(
      status(
        "E1-22",
        game("arcade-run", { start: 'CARTRIDGE.send("start");' }),
      ),
    ).toBe("fail");
  });
});

describe("E1-23 layout", () => {
  it("passes a resize listener or viewport units", () => {
    expect(status("E1-23", game())).toBe("pass");
    expect(
      status(
        "E1-23",
        game("arcade-run", {
          layout: "",
          style: "<style>canvas { height: 100dvh; }</style>",
        }),
      ),
    ).toBe("pass");
  });
  it("fails a fixed layout", () => {
    expect(status("E1-23", game("arcade-run", { layout: "" }))).toBe("fail");
  });
});

describe("E1-24 toy-box clear-the-table", () => {
  it("passes when a control calls the reset function", () => {
    expect(status("E1-24", game("toy-box"))).toBe("pass");
    const inline = game("toy-box", {
      body: '<canvas id="stage"></canvas><button onclick="clearTable()">Clear</button>',
      extra: "function clearTable() { score = 0; }",
    });
    expect(status("E1-24", inline)).toBe("pass");
    const arrow = game("toy-box", {
      extra:
        'function clearTable() { score = 0; }\nclear.addEventListener("pointerup", () => { clearTable(); });',
    });
    expect(status("E1-24", arrow)).toBe("pass");
  });
  it("reads switch cases and block branches", () => {
    const switchHost = [
      'window.addEventListener("message", (event) => {',
      '  if (event.data.source !== "cartridge-host") return;',
      "  switch (event.data.type) {",
      '    case "pause": paused = true; break;',
      '    case "resume": paused = false; break;',
      '    case "reset": clearTable(); break;',
      "  }",
      "});",
    ].join("\n");
    expect(status("E1-24", game("toy-box", { host: switchHost }))).toBe("pass");
    const blockHost = HOST_HANDLER("{ paused = false; clearTable(); }");
    expect(status("E1-24", game("toy-box", { host: blockHost }))).toBe("pass");
  });
  it("fails without a control or without a reset handler", () => {
    expect(
      status(
        "E1-24",
        game("toy-box", { extra: "function clearTable() { score = 0; }" }),
      ),
    ).toBe("fail");
    const noReset = HOST_HANDLER("clearTable()").replace(
      '"reset"',
      '"restart"',
    );
    expect(
      status(
        "E1-24",
        game("toy-box", { host: noReset, extra: TOY_BOX_CONTROL }),
      ),
    ).toBe("fail");
  });
  it("fails when the control calls a different function than reset", () => {
    const otherControl = game("toy-box", {
      extra: [
        "function clearTable() { score = 0; }",
        "function spawnToy() { score += 1; }",
        'document.getElementById("clear").addEventListener("click", spawnToy);',
        'window.addEventListener("keydown", clearTable);',
      ].join("\n"),
    });
    expect(status("E1-24", otherControl)).toBe("fail");
  });

  it("is n/a for other types", () => {
    expect(status("E1-24", game())).toBe("n/a");
  });
});
