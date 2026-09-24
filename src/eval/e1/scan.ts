/** A string or template literal found in script source. */
export interface StringLiteral {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly dynamic: boolean;
}

/** Source with comments and literal contents blanked, plus every literal found. */
export interface Lexed {
  readonly source: string;
  readonly masked: string;
  readonly literals: readonly StringLiteral[];
  readonly literalAt: ReadonlyMap<number, StringLiteral>;
}

export type PayloadValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "expression"; readonly text: string };

/** One `CARTRIDGE.send("<event>", …)` call. */
export interface CallSite {
  readonly event: string;
  readonly start: number;
  readonly hasPayloadArg: boolean;
  readonly payload: ReadonlyMap<string, PayloadValue> | null;
}

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "void",
  "delete",
  "new",
  "throw",
  "else",
  "do",
]);
const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r" };
const CALL_PATTERN = /\bCARTRIDGE\s*\.\s*send\s*\(/g;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

interface LexState {
  readonly source: string;
  readonly out: string[];
  readonly literals: StringLiteral[];
}

function blank(state: LexState, from: number, to: number): void {
  for (let index = from; index < to; index += 1) {
    if (state.source[index] !== "\n") state.out[index] = " ";
  }
}

function unescape(raw: string): string {
  return raw.replace(
    /\\(.)/gs,
    (_match, char: string) => ESCAPES[char] ?? char,
  );
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (
    index < source.length &&
    source[index] !== quote &&
    source[index] !== "\n"
  ) {
    index += source[index] === "\\" ? 2 : 1;
  }
  return Math.min(index + 1, source.length);
}

function skipTemplate(
  source: string,
  start: number,
): { end: number; dynamic: boolean } {
  let index = start + 1;
  let dynamic = false;
  while (index < source.length && source[index] !== "`") {
    if (source[index] === "\\") index += 2;
    else if (source.startsWith("${", index)) {
      dynamic = true;
      index = skipExpression(source, index + 2);
    } else index += 1;
  }
  return { end: Math.min(index + 1, source.length), dynamic };
}

function skipExpression(source: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '"' || char === "'") index = skipQuoted(source, index);
    else if (char === "`") index = skipTemplate(source, index).end;
    else {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      index += 1;
    }
  }
  return index;
}

function skipRegex(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && source[index] !== "\n") {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return index + 1;
    index += 1;
  }
  return index;
}

function regexAllowed(
  source: string,
  out: readonly string[],
  index: number,
): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(out[cursor] ?? "")) cursor -= 1;
  if (cursor < 0) return true;
  const previous = out[cursor] ?? "";
  if (REGEX_PRECEDERS.has(previous)) return true;
  const word = /[\w$]+$/.exec(source.slice(0, cursor + 1))?.[0];
  return word !== undefined && REGEX_KEYWORDS.has(word);
}

function lexLiteral(state: LexState, index: number): number {
  const { source } = state;
  const isTemplate = source[index] === "`";
  const { end, dynamic } = isTemplate
    ? skipTemplate(source, index)
    : { end: skipQuoted(source, index), dynamic: false };
  const raw = source.slice(index + 1, Math.max(index + 1, end - 1));
  state.literals.push({
    start: index,
    end,
    value: dynamic ? raw : unescape(raw),
    dynamic,
  });
  blank(state, index + 1, end - 1);
  return end;
}

function lexStep(state: LexState, index: number): number {
  const { source } = state;
  const char = source[index];
  const next = source[index + 1];
  if (char === "/" && next === "/") {
    const end = source.indexOf("\n", index);
    const stop = end < 0 ? source.length : end;
    blank(state, index, stop);
    return stop;
  }
  if (char === "/" && next === "*") {
    const end = source.indexOf("*/", index + 2);
    const stop = end < 0 ? source.length : end + 2;
    blank(state, index, stop);
    return stop;
  }
  if (char === '"' || char === "'" || char === "`")
    return lexLiteral(state, index);
  if (char === "/" && regexAllowed(source, state.out, index)) {
    const end = skipRegex(source, index);
    blank(state, index + 1, end - 1);
    return end;
  }
  return index + 1;
}

/**
 * Blanks comments, string contents and regex bodies (same length, newlines kept) and records literals.
 * @param source JavaScript source
 */
export function lexSource(source: string): Lexed {
  const state: LexState = { source, out: source.split(""), literals: [] };
  let index = 0;
  while (index < source.length) index = lexStep(state, index);
  const literalAt = new Map(
    state.literals.map((literal) => [literal.start, literal]),
  );
  return {
    source,
    masked: state.out.join(""),
    literals: state.literals,
    literalAt,
  };
}

/**
 * Finds the index just past the bracket that closes the one at `open`, or -1.
 * @param masked masked source (brackets in strings and comments are already blank)
 * @param open index of an opening `{`, `(` or `[`
 */
export function matchBracket(masked: string, open: number): number {
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    const char = masked[index] ?? "";
    if ("{([".includes(char)) depth += 1;
    if ("})]".includes(char)) depth -= 1;
    if (depth === 0) return index + 1;
  }
  return -1;
}

function skipSpace(masked: string, index: number): number {
  let cursor = index;
  while (cursor < masked.length && /\s/.test(masked[cursor] ?? "")) cursor += 1;
  return cursor;
}

function splitTopLevel(
  masked: string,
  from: number,
  to: number,
  separator: string,
): Array<[number, number]> {
  const parts: Array<[number, number]> = [];
  let depth = 0;
  let segmentStart = from;
  for (let index = from; index < to; index += 1) {
    const char = masked[index] ?? "";
    if ("{([".includes(char)) depth += 1;
    if ("})]".includes(char)) depth -= 1;
    if (depth === 0 && char === separator) {
      parts.push([segmentStart, index]);
      segmentStart = index + 1;
    }
  }
  parts.push([segmentStart, to]);
  return parts;
}

function trimRange(masked: string, from: number, to: number): [number, number] {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(masked[start] ?? "")) start += 1;
  while (end > start && /\s/.test(masked[end - 1] ?? "")) end -= 1;
  return [start, end];
}

/**
 * Classifies the source text in a range as a static string, a number or an expression.
 * @param lexed lexed source
 * @param from range start
 * @param to range end
 */
export function classifyValue(
  lexed: Lexed,
  from: number,
  to: number,
): PayloadValue {
  const [start, end] = trimRange(lexed.masked, from, to);
  const text = lexed.source.slice(start, end);
  const literal = lexed.literalAt.get(start);
  if (literal && literal.end === end && !literal.dynamic)
    return { kind: "string", value: literal.value };
  if (NUMBER_PATTERN.test(text)) return { kind: "number", value: Number(text) };
  return { kind: "expression", text };
}

function readKey(lexed: Lexed, from: number, to: number): string | null {
  const [start, end] = trimRange(lexed.masked, from, to);
  const literal = lexed.literalAt.get(start);
  if (literal && literal.end === end) return literal.value;
  const text = lexed.source.slice(start, end);
  return IDENTIFIER_PATTERN.test(text) ? text : null;
}

function readProperty(
  lexed: Lexed,
  from: number,
  to: number,
): [string, PayloadValue] | null {
  const [start, end] = trimRange(lexed.masked, from, to);
  if (start === end || lexed.source.startsWith("...", start)) return null;
  const colon = splitTopLevel(lexed.masked, start, end, ":");
  const [keyRange, valueRange] = colon;
  if (!keyRange) return null;
  const key = readKey(lexed, keyRange[0], keyRange[1]);
  if (key === null) return null;
  const value = valueRange
    ? classifyValue(lexed, valueRange[0], end)
    : classifyValue(lexed, start, end);
  return [key, value];
}

/**
 * Parses the top-level properties of an object literal spanning `open` .. `close`.
 * @param lexed lexed source
 * @param open index of `{`
 * @param close index just past the matching `}`
 */
export function parseObjectLiteral(
  lexed: Lexed,
  open: number,
  close: number,
): Map<string, PayloadValue> {
  const properties = new Map<string, PayloadValue>();
  for (const [from, to] of splitTopLevel(
    lexed.masked,
    open + 1,
    close - 1,
    ",",
  )) {
    const property = readProperty(lexed, from, to);
    if (property) properties.set(property[0], property[1]);
  }
  return properties;
}

function readCallSite(
  lexed: Lexed,
  callStart: number,
  argStart: number,
): CallSite | null {
  const literal = lexed.literalAt.get(argStart);
  if (!literal || literal.dynamic) return null;
  let cursor = skipSpace(lexed.masked, literal.end);
  if (lexed.masked[cursor] === ",")
    cursor = skipSpace(lexed.masked, cursor + 1);
  const hasPayloadArg = lexed.masked[cursor] !== ")";
  if (lexed.masked[cursor] !== "{")
    return {
      event: literal.value,
      start: callStart,
      hasPayloadArg,
      payload: null,
    };
  const close = matchBracket(lexed.masked, cursor);
  const payload = close < 0 ? null : parseObjectLiteral(lexed, cursor, close);
  return { event: literal.value, start: callStart, hasPayloadArg, payload };
}

/**
 * Finds every `CARTRIDGE.send("<event>", …)` call with a static event name.
 * @param lexed lexed script source
 */
export function findCallSites(lexed: Lexed): CallSite[] {
  const sites: CallSite[] = [];
  for (const match of lexed.masked.matchAll(CALL_PATTERN)) {
    const argStart = skipSpace(lexed.masked, match.index + match[0].length);
    const site = readCallSite(lexed, match.index, argStart);
    if (site) sites.push(site);
  }
  return sites;
}
