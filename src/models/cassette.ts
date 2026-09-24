import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  realSleep,
  systemClock,
  type Clock,
  type Sleep,
} from "../engine/clock.ts";
import type { Usage } from "../engine/usage.ts";
import {
  CASSETTE_FORMAT,
  Cassette,
  CassetteIndex,
  PRICE_TABLE_VERSION,
} from "./cassette-format.ts";
import { assertNoVolatile, requestKey } from "./request-key.ts";

/** Longest pause between replayed events at `pace=recorded` (arbitrary). */
export const REPLAY_MAX_GAP_MS = 1_500;
const EVENT_SEPARATOR = "\n\n";
const INDEX_FILE = "index.json";
const SSE_CONTENT_TYPE = "text/event-stream";
const KEY_PREFIX = "sha256:";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type CassetteMode = "live" | "record" | "replay";
export type CassettePace = "instant" | "recorded";
export type CassetteRole = Cassette["role"];

export interface CassetteOptions {
  readonly mode: CassetteMode;
  readonly dir: string;
  readonly role: CassetteRole;
  readonly model: string;
  readonly upstream?: FetchLike | undefined;
  readonly pace?: CassettePace | undefined;
  readonly clock?: Clock | undefined;
  readonly sleep?: Sleep | undefined;
}

/** Replay found no recording for a request. Mapped to `cassette-miss` (§4.5). */
export class CassetteMissError extends Error {
  override readonly name = "CassetteMissError";
}

/** Record mode saw a request that would not produce an event-stream body. */
export class CassetteFormatError extends Error {
  override readonly name = "CassetteFormatError";
}

interface ParsedRequest {
  readonly url: string;
  readonly body: unknown;
  readonly key: string;
}

/**
 * Splits a raw SSE body into its events, each keeping its trailing blank line.
 * @param body raw `text/event-stream` text
 */
export function splitSseEvents(body: string): string[] {
  const parts = body.split(EVENT_SEPARATOR);
  const events = parts.slice(0, -1).map((part) => part + EVENT_SEPARATOR);
  const tail = parts.at(-1) ?? "";
  return tail.length > 0 ? [...events, tail] : events;
}

function dataOf(event: string): Record<string, unknown> | null {
  const line = event.split("\n").find((entry) => entry.startsWith("data:"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice("data:".length)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function numberAt(source: unknown, key: string): number {
  if (typeof source !== "object" || source === null) return 0;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

/**
 * Reads disjoint usage from an Anthropic stream: uncached input, cache read and cache write come
 * from `message_start`, output from the last `message_delta`.
 * @param body raw `text/event-stream` text
 */
export function usageFromSse(body: string): Usage {
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const event of splitSseEvents(body)) {
    const data = dataOf(event);
    if (data?.type === "message_start") {
      const start = (data.message as { usage?: unknown } | undefined)?.usage;
      usage.input = numberAt(start, "input_tokens");
      usage.cacheRead = numberAt(start, "cache_read_input_tokens");
      usage.cacheWrite = numberAt(start, "cache_creation_input_tokens");
    }
    if (data?.type === "message_delta")
      usage.output = numberAt(data.usage, "output_tokens");
  }
  return usage;
}

function parseRequest(
  input: string | URL | Request,
  init?: RequestInit,
): ParsedRequest {
  const href = input instanceof Request ? input.url : String(input);
  const url = new URL(href).pathname;
  if (typeof init?.body !== "string")
    throw new CassetteFormatError("the request body must be a JSON string");
  const body: unknown = JSON.parse(init.body);
  assertNoVolatile(body);
  return { url, body, key: requestKey(url, body) };
}

function fileStem(key: string, occurrence: number): string {
  const hex = key.slice(KEY_PREFIX.length);
  return occurrence === 0 ? hex : `${hex}.${occurrence}`;
}

function indexEntry(key: string, occurrence: number): string {
  return occurrence === 0 ? key : `${key}#${occurrence}`;
}

async function readTimed(
  response: Response,
  clock: Clock,
): Promise<{ body: string; gapsMs: number[] }> {
  const decoder = new TextDecoder();
  const gapsMs: number[] = [];
  let body = "";
  let last = clock.now();
  let seen = 0;
  for await (const chunk of response.body ?? []) {
    body += decoder.decode(chunk as Uint8Array, { stream: true });
    const complete = body.split(EVENT_SEPARATOR).length - 1;
    const now = clock.now();
    for (; seen < complete; seen += 1) gapsMs.push(seen === 0 ? 0 : now - last);
    last = now;
  }
  body += decoder.decode();
  for (; seen < splitSseEvents(body).length; seen += 1) gapsMs.push(0);
  return { body, gapsMs };
}

function appendIndex(dir: string, entry: string): void {
  const path = join(dir, INDEX_FILE);
  const index: CassetteIndex = existsSync(path)
    ? CassetteIndex.parse(JSON.parse(readFileSync(path, "utf8")))
    : { keys: [] };
  index.keys.push(entry);
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`);
}

function sseResponse(body: string | ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": SSE_CONTENT_TYPE },
  });
}

function pacedBody(
  cassette: Cassette,
  sleep: Sleep,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = splitSseEvents(cassette.response.body);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [index, event] of events.entries()) {
        const gap = cassette.response.gapsMs[index] ?? 0;
        await sleep(Math.min(gap, REPLAY_MAX_GAP_MS));
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

interface Recorder {
  readonly options: CassetteOptions;
  readonly occurrences: Map<string, number>;
}

async function record(
  state: Recorder,
  request: ParsedRequest,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const { options } = state;
  if ((request.body as { stream?: unknown }).stream !== true)
    throw new CassetteFormatError(
      "record mode only accepts streaming requests",
    );
  const upstream = options.upstream ?? fetch;
  const response = await upstream(input, init);
  if (!response.ok) return response;
  const { body, gapsMs } = await readTimed(
    response,
    options.clock ?? systemClock,
  );
  const occurrence = state.occurrences.get(request.key) ?? 0;
  state.occurrences.set(request.key, occurrence + 1);
  writeCassette(options, request, occurrence, body, gapsMs);
  return sseResponse(body);
}

function writeCassette(
  options: CassetteOptions,
  request: ParsedRequest,
  occurrence: number,
  body: string,
  gapsMs: number[],
): void {
  const cassette: Cassette = {
    format: CASSETTE_FORMAT,
    key: request.key,
    occurrence,
    role: options.role,
    model: options.model,
    request: { url: request.url, body: request.body },
    response: { status: 200, contentType: SSE_CONTENT_TYPE, body, gapsMs },
    usage: usageFromSse(body),
    priceTableVersion: PRICE_TABLE_VERSION,
  };
  mkdirSync(options.dir, { recursive: true });
  const path = join(options.dir, `${fileStem(request.key, occurrence)}.json`);
  writeFileSync(path, `${JSON.stringify(Cassette.parse(cassette), null, 2)}\n`);
  appendIndex(options.dir, indexEntry(request.key, occurrence));
}

function replay(state: Recorder, request: ParsedRequest): Response {
  const { options } = state;
  const occurrence = state.occurrences.get(request.key) ?? 0;
  state.occurrences.set(request.key, occurrence + 1);
  const path = join(options.dir, `${fileStem(request.key, occurrence)}.json`);
  if (!existsSync(path))
    throw new CassetteMissError(
      `no cassette for ${indexEntry(request.key, occurrence)} in ${options.dir}`,
    );
  const cassette = Cassette.parse(JSON.parse(readFileSync(path, "utf8")));
  if (options.pace !== "recorded") return sseResponse(cassette.response.body);
  return sseResponse(pacedBody(cassette, options.sleep ?? realSleep));
}

/**
 * Builds the fetch the Anthropic provider uses: `live` passes through, `record` writes each 2xx
 * streaming response the moment it completes, `replay` never touches the network (§7.2).
 * @param options mode, cassette directory and recording metadata
 */
export function cassetteFetch(options: CassetteOptions): FetchLike {
  const state: Recorder = { options, occurrences: new Map() };
  return async (input, init) => {
    if (options.mode === "live")
      return (options.upstream ?? fetch)(input, init);
    const request = parseRequest(input, init);
    if (options.mode === "replay") return replay(state, request);
    return record(state, request, input, init);
  };
}
