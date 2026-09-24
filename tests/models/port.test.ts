import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  MODEL_IDS,
  MissingApiKeyError,
  REPLAY_PLACEHOLDER_KEY,
  createModel,
  modelModeFromEnv,
} from "../../src/models/port.ts";
import { scriptedTurns } from "../../src/models/mock.ts";
import { toUsage } from "../../src/engine/usage.ts";
import { fakeUpstream, textSse, toolSse } from "./sse-fixtures.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "port-"));
  dirs.push(dir);
  return dir;
}

const echoTool = createTool({
  id: "save_draft",
  description: "store html",
  inputSchema: z.object({ html: z.string() }),
  outputSchema: z.object({ version: z.string() }),
  execute: () => Promise.resolve({ version: "a0" }),
});

async function runAgent(model: ReturnType<typeof createModel>) {
  const agent = new Agent({
    id: "builder",
    name: "builder",
    instructions: "Build the page.",
    model,
    tools: { save_draft: echoTool },
    maxRetries: 0,
  });
  const output = await agent.stream("make it", { maxSteps: 3 });
  await output.consumeStream();
  return {
    text: await output.text,
    usage: toUsage(await output.totalUsage),
    finishReason: await output.finishReason,
  };
}

describe("model port (§7.1)", () => {
  it("maps roles to model ids", () => {
    expect(MODEL_IDS).toEqual({
      planner: "claude-sonnet-5",
      builder: "claude-sonnet-5",
      judge: "claude-haiku-4-5",
    });
  });

  it("defaults to replay and reads CARTRIDGE_MODEL_MODE", () => {
    expect(modelModeFromEnv({})).toBe("replay");
    expect(modelModeFromEnv({ CARTRIDGE_MODEL_MODE: "mock" })).toBe("mock");
    expect(() => modelModeFromEnv({ CARTRIDGE_MODEL_MODE: "wild" })).toThrow();
  });

  it("refuses live and record modes without a key", () => {
    expect(() => createModel("builder", "live", { env: {} })).toThrow(
      MissingApiKeyError,
    );
    expect(() =>
      createModel("builder", "record", { env: {}, cassetteDir: tempDir() }),
    ).toThrow(MissingApiKeyError);
  });

  it("needs a script in mock mode and a directory in replay mode", () => {
    expect(() => createModel("builder", "mock", {})).toThrow(/mock/);
    expect(() => createModel("builder", "replay", {})).toThrow(/cassetteDir/);
  });

  it("returns the scripted model in mock mode", () => {
    const mock = scriptedTurns([{ kind: "text", text: "hi" }]);
    expect(createModel("planner", "mock", { mock })).toBe(mock);
  });

  it("records through the real provider and replays with no key in the environment", async () => {
    const dir = tempDir();
    const upstream = fakeUpstream([
      toolSse(
        "save_draft",
        { html: "<p>" },
        { input: 10, output: 5, cacheRead: 4, cacheWrite: 6 },
      ),
      textSse("saved"),
    ]);
    const recorded = await runAgent(
      createModel("builder", "record", {
        cassetteDir: dir,
        env: { ANTHROPIC_API_KEY: "sk-test" },
        upstream: upstream.fetch,
      }),
    );
    const firstRequest = upstream.requests[0] as { stream?: boolean };
    expect(firstRequest.stream).toBe(true);

    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const replayed = await runAgent(
        createModel("builder", "replay", {
          cassetteDir: dir,
          env: process.env,
        }),
      );
      expect(replayed).toEqual(recorded);
      expect(replayed.usage).toEqual({
        input: 13,
        output: 7,
        cacheRead: 4,
        cacheWrite: 6,
      });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("uses a placeholder key that is never a real key", () => {
    expect(REPLAY_PLACEHOLDER_KEY).toBe("replay-no-key");
  });
});
