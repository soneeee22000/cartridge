const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const ESCAPE_PATTERN = /[&<>"']/g;
const CODE_PATTERN = /`([^`]+)`/g;
const LINK_PATTERN = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/** Escape text for safe interpolation into HTML or SVG markup. */
export function esc(value: string | number): string {
  return String(value).replace(
    ESCAPE_PATTERN,
    (character) => HTML_ESCAPES[character] ?? character,
  );
}

/** Escape an identifier and allow line breaks after underscores instead of truncating. */
export function breakable(identifier: string): string {
  return esc(identifier).replaceAll("_", "_<wbr>");
}

/** A machine string in the monospace face, wrapped at underscores. */
export function code(identifier: string): string {
  return `<code>${breakable(identifier)}</code>`;
}

/** Escape copy, then render `code` spans and [label](https://...) links. */
export function richText(text: string): string {
  return esc(text)
    .replace(LINK_PATTERN, '<a href="$2">$1</a>')
    .replace(
      CODE_PATTERN,
      (_match, inner: string) =>
        `<code>${inner.replaceAll("_", "_<wbr>")}</code>`,
    );
}

/** Replace `{name}` placeholders; a missing value is a programming error. */
export function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const value = values[key];
    if (value === undefined)
      throw new Error(`No value for placeholder {${key}}`);
    return String(value);
  });
}

/** Join items as "a", "a and b" or "a, b and c". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** Find a required element by selector and check its type. */
export function query<T extends Element>(
  root: ParentNode,
  selector: string,
  type: abstract new () => T,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type))
    throw new Error(`Missing element ${selector}`);
  return element;
}

/** All elements matching a selector that are of the given type. */
export function queryAll<T extends Element>(
  root: ParentNode,
  selector: string,
  type: abstract new () => T,
): T[] {
  return Array.from(root.querySelectorAll(selector)).filter(
    (element): element is T => element instanceof type,
  );
}

/** Render markup into a section shell by id and return the shell. */
export function mount(id: string, markup: string): HTMLElement {
  const shell = document.getElementById(id);
  if (shell === null) throw new Error(`Missing section shell #${id}`);
  shell.innerHTML = markup;
  return shell;
}

/** Whether the reader asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The closest ancestor-or-self of an event target matching a selector. */
export function closestTarget(
  event: Event,
  selector: string,
): HTMLElement | null {
  const origin = event.target;
  if (!(origin instanceof Element)) return null;
  const match = origin.closest(selector);
  return match instanceof HTMLElement ? match : null;
}
