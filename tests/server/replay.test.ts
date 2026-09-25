import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FAST_FORWARD_FACTOR } from "../../src/models/cassette.ts";
import {
  createPromptsHandler,
  createReplayHandler,
  loadReplayCatalog,
} from "../../src/server/replay.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REPLAY_TIMEOUT_MS = 120_000;
const FAST_RELAY = { pollMs: 5 };

interface SseMessage {
  readonly id?: string;
  readonly event?: string;
  readonly data?: string;
}

function parseSse(text: string): SseMessage[] {
  return text
    .split("\n\n")
    .filter((block) => block.length > 0 && !block.startsWith(":"))
    .map((block) => {
      const message: Record<string, string> = {};
      for (const line of block.split("\n")) {
        const colon = line.indexOf(": ");
        if (colon > 0) message[line.slice(0, colon)] = line.slice(colon + 2);
      }
      return message;
    });
}

function committedSha(itemId: string): string {
  const run = JSON.parse(
    readFileSync(join(REPO_ROOT, "games", itemId, "run.json"), "utf8"),
  ) as { artifact: { sha256: string } };
  return run.artifact.sha256;
}

async function replay(
  itemId: string,
  headers: Record<string, string> = {},
): Promise<SseMessage[]> {
  const handler = createReplayHandler({
    root: REPO_ROOT,
    pace: "instant",
    relay: FAST_RELAY,
  });
  const response = await handler(
    new Request(`https://cartridge.test/api/replay?promptId=${itemId}`, {
      headers,
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  return parseSse(await response.text());
}

describe("replay catalog", () => {
  it("lists every dataset item that has committed cassettes, repaired items first", () => {
    const catalog = loadReplayCatalog(REPO_ROOT);
    expect(catalog).toHaveLength(20);
    const firstPlain = catalog.findIndex((entry) => entry.buildAttempts === 1);
    const lastRepaired = catalog.findLastIndex(
      (entry) => entry.buildAttempts > 1,
    );
    expect(lastRepaired).toBeLessThan(firstPlain);
    expect(catalog[0]).toMatchObject({
      id: expect.any(String) as string,
      lang: expect.stringMatching(/^(en|fr)$/) as string,
      prompt: expect.any(String) as string,
    });
  });

  it("serves the catalog as JSON from GET /api/prompts", async () => {
    const response = await createPromptsHandler({ root: REPO_ROOT })(
      new Request("https://cartridge.test/api/prompts"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(20);
  });
});

describe("GET /api/replay", () => {
  const handler = createReplayHandler({ root: REPO_ROOT, pace: "instant" });

  it("returns 404 for a prompt id outside the catalog", async () => {
    const response = await handler(
      new Request("https://cartridge.test/api/replay?promptId=not-an-item"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 when the prompt id is missing or malformed", async () => {
    for (const query of ["", "?promptId=", "?promptId=..%2Fetc"]) {
      const response = await handler(
        new Request(`https://cartridge.test/api/replay${query}`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("returns 400 for a pace other than fast or recorded", async () => {
    const response = await handler(
      new Request(
        "https://cartridge.test/api/replay?promptId=bubble-pop&pace=slow",
      ),
    );
    expect(response.status).toBe(400);
  });

  it(
    "fast-forwards by default and honours ?pace=recorded",
    async () => {
      const totalWait = async (query: string): Promise<number> => {
        let total = 0;
        const paced = createReplayHandler({
          root: REPO_ROOT,
          relay: FAST_RELAY,
          sleep: (ms) => {
            total += ms;
            return Promise.resolve();
          },
        });
        const response = await paced(
          new Request(
            `https://cartridge.test/api/replay?promptId=tile-sort${query}`,
          ),
        );
        await response.text();
        return total;
      };
      const fast = await totalWait("");
      const recorded = await totalWait("&pace=recorded");
      expect(recorded).toBeGreaterThan(0);
      expect(fast).toBeCloseTo(recorded / FAST_FORWARD_FACTOR, 3);
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    "replays a reconnect instantly, whatever pace the visitor picked",
    async () => {
      let waited = 0;
      const paced = createReplayHandler({
        root: REPO_ROOT,
        relay: FAST_RELAY,
        sleep: (ms) => {
          waited += ms;
          return Promise.resolve();
        },
      });
      const response = await paced(
        new Request(
          "https://cartridge.test/api/replay?promptId=tile-sort&pace=recorded",
          { headers: { "last-event-id": "3" } },
        ),
      );
      await response.text();
      expect(waited).toBe(0);
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    "answers 204 to a reconnect at or past the terminal id of a finished replay",
    async () => {
      const once = createReplayHandler({
        root: REPO_ROOT,
        pace: "instant",
        relay: FAST_RELAY,
      });
      const first = await once(
        new Request("https://cartridge.test/api/replay?promptId=tile-sort"),
      );
      const terminalId = Number(parseSse(await first.text()).at(-1)?.id);
      const late = await once(
        new Request("https://cartridge.test/api/replay?promptId=tile-sort", {
          headers: { "last-event-id": String(terminalId) },
        }),
      );
      expect(late.status).toBe(204);
    },
    REPLAY_TIMEOUT_MS,
  );

  it("answers 429 once the instance is running its maximum of replays", async () => {
    const hold = new AbortController();
    const busy = createReplayHandler({
      root: REPO_ROOT,
      maxConcurrent: 1,
      relay: FAST_RELAY,
      sleep: () => new Promise<void>(() => undefined),
    });
    const first = await busy(
      new Request("https://cartridge.test/api/replay?promptId=tile-sort", {
        signal: hold.signal,
      }),
    );
    expect(first.status).toBe(200);
    const second = await busy(
      new Request("https://cartridge.test/api/replay?promptId=bubble-pop"),
    );
    expect(second.status).toBe(429);
    hold.abort();
    await first.body?.cancel();
  });

  it("rejects methods other than GET", async () => {
    const response = await handler(
      new Request("https://cartridge.test/api/replay?promptId=bubble-pop", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(405);
  });

  it(
    "streams a repaired run keyless and ends with the committed artifact",
    async () => {
      const messages = await replay("bubble-pop");
      const progress = messages.filter((m) => m.event === "progress");
      const kinds = progress.map(
        (m) => (JSON.parse(m.data ?? "{}") as { kind: string }).kind,
      );
      expect(kinds).toContain("repair.start");
      expect(kinds.filter((kind) => kind === "verify.verdict")).toHaveLength(2);
      const terminal = messages.at(-1);
      expect(terminal?.event).toBe("terminal");
      const data = JSON.parse(terminal?.data ?? "{}") as {
        status: string;
        artifact: { sha256: string; html: string };
        e1Score: number;
      };
      expect(data.status).toBe("complete");
      expect(data.artifact.sha256).toBe(committedSha("bubble-pop"));
      expect(data.e1Score).toBe(1);
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    "resumes after Last-Event-ID and sends only the missing tail",
    async () => {
      const full = await replay("bubble-pop");
      const resumed = await replay("bubble-pop", { "last-event-id": "3" });
      const ids = resumed
        .filter((m) => m.event === "progress")
        .map((m) => Number(m.id));
      expect(Math.min(...ids)).toBe(4);
      expect(resumed.length).toBe(full.length - 3);
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    "reproduces the committed artifact byte for byte for every catalog item",
    async () => {
      for (const entry of loadReplayCatalog(REPO_ROOT)) {
        const terminal = (await replay(entry.id)).at(-1);
        const data = JSON.parse(terminal?.data ?? "{}") as {
          artifact?: { sha256: string };
        };
        expect(data.artifact?.sha256, entry.id).toBe(committedSha(entry.id));
      }
    },
    REPLAY_TIMEOUT_MS * 4,
  );
});
