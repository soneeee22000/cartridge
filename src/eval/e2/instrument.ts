/** `source` on messages the probe's own script forwards to the host. */
export const PROBE_SOURCE = "cartridge-probe";

/**
 * The one script the probe adds to a game. It forwards `error`, `unhandledrejection` and
 * `console.error` to the host so the probe does not depend on Playwright seeing errors raised
 * inside a sandboxed child frame (§8.1).
 */
export const INSTRUMENT_SCRIPT = [
  "(function () {",
  "  function forward(kind, message) {",
  `    window.parent.postMessage({ source: "${PROBE_SOURCE}", kind: kind, message: String(message) }, "*");`,
  "  }",
  '  window.addEventListener("error", function (event) { forward("error", event.message); });',
  '  window.addEventListener("unhandledrejection", function (event) {',
  "    var reason = event.reason;",
  '    forward("unhandledrejection", reason && reason.message ? reason.message : reason);',
  "  });",
  "  var original = console.error;",
  "  console.error = function () {",
  '    forward("console.error", Array.prototype.map.call(arguments, String).join(" "));',
  "    return original.apply(console, arguments);",
  "  };",
  "})();",
].join("\n");

const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const HEAD_OPEN = /<head(?=[\s>])[^>]*>/i;
const HTML_OPEN = /<html(?=[\s>])[^>]*>/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

function blankComments(html: string): string {
  return html.replace(COMMENT_PATTERN, (comment) => " ".repeat(comment.length));
}

function insertionPoint(html: string): number {
  const visible = blankComments(html);
  for (const pattern of [HEAD_OPEN, HTML_OPEN, DOCTYPE]) {
    const match = pattern.exec(visible);
    if (match) return match.index + match[0].length;
  }
  return 0;
}

/**
 * Adds the instrumentation script right after `<head…>`, else after `<html…>`, else after the
 * doctype. It never goes before the doctype, which would switch the page to quirks mode.
 * @param html the game document
 */
export function instrumentGame(html: string): string {
  const at = insertionPoint(html);
  const tag = `<script>${INSTRUMENT_SCRIPT}</script>`;
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
}
