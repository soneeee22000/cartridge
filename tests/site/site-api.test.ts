import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSiteApi, type SiteApi } from "../../scripts/site-api.ts";

const REPLAY_TIMEOUT_MS = 60_000;

describe("site api server", () => {
  let api: SiteApi;

  beforeAll(async () => {
    api = await startSiteApi({ port: 0, pace: "instant" });
  });

  afterAll(async () => {
    await api.close();
  });

  it("serves the prompt catalog", async () => {
    const response = await fetch(`${api.url}/api/prompts`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(20);
  });

  it(
    "streams a replay that ends with a terminal event",
    async () => {
      const response = await fetch(`${api.url}/api/replay?promptId=tile-sort`);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const text = await response.text();
      expect(text).toContain("event: progress");
      expect(text.trimEnd().split("\n\n").at(-1)).toMatch(
        /^id: \d+\nevent: terminal\n/,
      );
    },
    REPLAY_TIMEOUT_MS,
  );

  it("answers 404 outside /api/prompts and /api/replay", async () => {
    const response = await fetch(`${api.url}/api/other`);
    expect(response.status).toBe(404);
  });
});
