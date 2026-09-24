import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CassetteFormatError,
  CassetteMissError,
  REPLAY_MAX_GAP_MS,
  FAST_FORWARD_FACTOR,
  cassetteFetch,
  splitSseEvents,
  usageFromSse,
} from "../../src/models/cassette.ts";
import { Cassette, CassetteIndex } from "../../src/models/cassette-format.ts";
import { fakeUpstream, textSse, toolSse } from "./sse-fixtures.ts";

const URL_MESSAGES = "https://api.anthropic.com/v1/messages";
const OVERLOADED = 529;
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cassette-"));
  dirs.push(dir);
  return join(dir, "run-key");
}

function post(body: object): RequestInit {
  return {
    method: "POST",
    headers: {
      "x-api-key": "sk-ant-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

const STREAM_BODY = {
  model: "claude-sonnet-5",
  stream: true,
  messages: [{ role: "user", content: "hi" }],
};

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("cassette record and replay (§7.2)", () => {
  it("round-trips a streaming response byte for byte and stores no headers", async () => {
    const dir = tempDir();
    const body = toolSse(
      "save_draft",
      { html: "<p>" },
      { input: 10, output: 5, cacheRead: 4, cacheWrite: 6 },
    );
    const upstream = fakeUpstream([body]);
    const record = cassetteFetch({
      mode: "record",
      dir,
      role: "builder",
      model: "claude-sonnet-5",
      upstream: upstream.fetch,
    });
    const recorded = await (
      await record(URL_MESSAGES, post(STREAM_BODY))
    ).text();

    const replay = cassetteFetch({
      mode: "replay",
      dir,
      role: "builder",
      model: "claude-sonnet-5",
    });
    const replayed = await replay(URL_MESSAGES, post(STREAM_BODY));
    expect(replayed.headers.get("content-type")).toBe("text/event-stream");
    expect(await replayed.text()).toBe(recorded);
    expect(recorded).toBe(body);

    const files = readdirSync(dir).filter((name) => name !== "index.json");
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(dir, files[0] ?? ""), "utf8");
    expect(raw).not.toMatch(/x-api-key|sk-ant-|authorization/i);
    const cassette = Cassette.parse(JSON.parse(raw));
    expect(cassette.usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: 4,
      cacheWrite: 6,
    });
    expect(cassette.response.gapsMs).toHaveLength(splitSseEvents(body).length);
    expect(cassette.request.url).toBe("/v1/messages");
    const index = CassetteIndex.parse(
      JSON.parse(readFileSync(join(dir, "index.json"), "utf8")),
    );
    expect(index.keys).toEqual([cassette.key]);
  });

  it("gives identical requests an occurrence index so they replay in order", async () => {
    const dir = tempDir();
    const upstream = fakeUpstream([textSse("first"), textSse("second")]);
    const record = cassetteFetch({
      mode: "record",
      dir,
      role: "planner",
      model: "m",
      upstream: upstream.fetch,
    });
    await (await record(URL_MESSAGES, post(STREAM_BODY))).text();
    await (await record(URL_MESSAGES, post(STREAM_BODY))).text();

    const replay = cassetteFetch({
      mode: "replay",
      dir,
      role: "planner",
      model: "m",
    });
    const first = await (await replay(URL_MESSAGES, post(STREAM_BODY))).text();
    const second = await (await replay(URL_MESSAGES, post(STREAM_BODY))).text();
    expect(first).toContain("first");
    expect(second).toContain("second");
    const repeats = readdirSync(dir).filter((name) => name.endsWith(".1.json"));
    expect(repeats).toHaveLength(1);
  });

  it("throws CassetteMissError in replay when nothing was recorded", async () => {
    const replay = cassetteFetch({
      mode: "replay",
      dir: tempDir(),
      role: "builder",
      model: "m",
    });
    await expect(
      replay(URL_MESSAGES, post(STREAM_BODY)),
    ).rejects.toBeInstanceOf(CassetteMissError);
  });

  it("refuses to record a non-streaming request", async () => {
    const upstream = fakeUpstream([textSse("x")]);
    const record = cassetteFetch({
      mode: "record",
      dir: tempDir(),
      role: "builder",
      model: "m",
      upstream: upstream.fetch,
    });
    await expect(
      record(URL_MESSAGES, post({ model: "m", messages: [] })),
    ).rejects.toBeInstanceOf(CassetteFormatError);
    expect(upstream.requests).toHaveLength(0);
  });

  it("returns a non-2xx response to the caller and never writes it", async () => {
    const dir = tempDir();
    const upstream = fakeUpstream(
      ['{"type":"error","error":{"type":"overloaded_error"}}'],
      OVERLOADED,
    );
    const record = cassetteFetch({
      mode: "record",
      dir,
      role: "builder",
      model: "m",
      upstream: upstream.fetch,
    });
    const response = await record(URL_MESSAGES, post(STREAM_BODY));
    expect(response.status).toBe(OVERLOADED);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it("does not spend an occurrence index on a failed call", async () => {
    const dir = tempDir();
    let calls = 0;
    const flaky = (() => {
      calls += 1;
      if (calls === 1)
        return Promise.resolve(new Response("{}", { status: OVERLOADED }));
      return Promise.resolve(
        new Response(textSse("after retry"), {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as typeof fetch;
    const record = cassetteFetch({
      mode: "record",
      dir,
      role: "builder",
      model: "m",
      upstream: flaky,
    });
    await record(URL_MESSAGES, post(STREAM_BODY));
    await (await record(URL_MESSAGES, post(STREAM_BODY))).text();
    const replay = cassetteFetch({
      mode: "replay",
      dir,
      role: "builder",
      model: "m",
    });
    const text = await (await replay(URL_MESSAGES, post(STREAM_BODY))).text();
    expect(text).toContain("after retry");
  });

  it("rejects volatile values before hashing", async () => {
    const upstream = fakeUpstream([textSse("x")]);
    const record = cassetteFetch({
      mode: "record",
      dir: tempDir(),
      role: "builder",
      model: "m",
      upstream: upstream.fetch,
    });
    const body = { ...STREAM_BODY, note: "2026-09-24T10:00:00Z" };
    await expect(record(URL_MESSAGES, post(body))).rejects.toThrow(/volatile/i);
  });

  it("passes through without recording in live mode", async () => {
    const dir = tempDir();
    const upstream = fakeUpstream([textSse("live")]);
    const live = cassetteFetch({
      mode: "live",
      dir,
      role: "builder",
      model: "m",
      upstream: upstream.fetch,
    });
    const text = await (await live(URL_MESSAGES, post(STREAM_BODY))).text();
    expect(text).toContain("live");
    expect(existsSync(dir)).toBe(false);
  });

  it("paces replay by the recorded gaps, capped", async () => {
    const dir = tempDir();
    const upstream = fakeUpstream([textSse("paced")]);
    const record = cassetteFetch({
      mode: "record",
      dir,
      role: "builder",
      model: "m",
      upstream: upstream.fetch,
    });
    await (await record(URL_MESSAGES, post(STREAM_BODY))).text();
    const waits: number[] = [];
    const replay = cassetteFetch({
      mode: "replay",
      dir,
      role: "builder",
      model: "m",
      pace: "recorded",
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const text = await (await replay(URL_MESSAGES, post(STREAM_BODY))).text();
    expect(text).toBe(textSse("paced"));
    expect(waits).toHaveLength(splitSseEvents(textSse("paced")).length);
    expect(Math.max(...waits)).toBeLessThanOrEqual(REPLAY_MAX_GAP_MS);
  });

  it("at fast pace, waits each recorded gap divided by the fast-forward factor", async () => {
    const dir = tempDir();
    const upstream = fakeUpstream([textSse("paced")]);
    const record = cassetteFetch({
      mode: "record",
      dir,
      role: "builder",
      model: "m",
      upstream: upstream.fetch,
    });
    await (await record(URL_MESSAGES, post(STREAM_BODY))).text();
    const waitsAt = async (pace: "recorded" | "fast"): Promise<number[]> => {
      const waits: number[] = [];
      const replay = cassetteFetch({
        mode: "replay",
        dir,
        role: "builder",
        model: "m",
        pace,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      });
      await (await replay(URL_MESSAGES, post(STREAM_BODY))).text();
      return waits;
    };
    const recorded = await waitsAt("recorded");
    const fast = await waitsAt("fast");
    expect(fast).toEqual(recorded.map((ms) => ms / FAST_FORWARD_FACTOR));
  });
});

describe("usageFromSse", () => {
  it("reads the four disjoint kinds from the raw stream", () => {
    const body = textSse("x", {
      input: 7,
      output: 9,
      cacheRead: 2,
      cacheWrite: 1,
    });
    expect(usageFromSse(body)).toEqual({
      input: 7,
      output: 9,
      cacheRead: 2,
      cacheWrite: 1,
    });
  });
});
