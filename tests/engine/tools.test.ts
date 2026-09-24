import { describe, expect, it } from "vitest";
import { RequestContext } from "@mastra/core/request-context";
import { MemoryArtifactStore } from "../../src/engine/artifacts/memory.ts";
import { MAX_GAME_BYTES } from "../../src/engine/budgets.ts";
import type { CartridgeContext } from "../../src/engine/schemas.ts";
import {
  createCartridgeTools,
  verifyTool,
} from "../../src/engine/tools/index.ts";
import { MOCK_GAME_HTML } from "../../src/models/mock.ts";

function contextFor(runKey: string, buildAttempt: number) {
  const requestContext = new RequestContext<CartridgeContext>();
  requestContext.set("runKey", runKey);
  requestContext.set("claimAttempt", 1);
  requestContext.set("buildAttempt", buildAttempt);
  return { requestContext };
}

async function call<T>(
  tool: {
    execute?: ((input: never, context: never) => Promise<unknown>) | undefined;
  },
  input: unknown,
  context: unknown = {},
): Promise<T> {
  if (!tool.execute) throw new Error("tool has no execute");
  return (await tool.execute(input as never, context as never)) as T;
}

describe("card tools (§4.3)", () => {
  it("lists cards sorted by id and filters by kind", async () => {
    const tools = createCartridgeTools(new MemoryArtifactStore());
    const all = await call<{ cards: { id: string }[] }>(tools.list_cards, {});
    const ids = all.cards.map((card) => card.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(12);
    const styles = await call<{ cards: { kind: string }[] }>(tools.list_cards, {
      kind: "style",
    });
    expect(styles.cards.every((card) => card.kind === "style")).toBe(true);
    expect(styles.cards).toHaveLength(3);
  });

  it("returns a card body by id and reports an unknown id as a validation error", async () => {
    const tools = createCartridgeTools(new MemoryArtifactStore());
    const card = await call<{ id: string; body: string }>(tools.get_card, {
      id: "bridge",
    });
    expect(card.id).toBe("bridge");
    expect(card.body).toContain("CARTRIDGE");
    const unknown = await call<{ error?: boolean }>(tools.get_card, {
      id: "nope",
    });
    expect(unknown.error).toBe(true);
  });
});

describe("draft tools (§4.3)", () => {
  it("saves idempotently per build attempt, keyed from the request context", async () => {
    const artifacts = new MemoryArtifactStore();
    const tools = createCartridgeTools(artifacts);
    const first = await call<{ version: string }>(
      tools.save_draft,
      { html: "one" },
      contextFor("kite-rush", 2),
    );
    const again = await call<{
      version: string;
      bytes: number;
      sha256: string;
    }>(tools.save_draft, { html: "two!" }, contextFor("kite-rush", 2));
    expect(first.version).toBe("a2");
    expect(again).toEqual({
      version: "a2",
      bytes: 4,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
    });
    expect(JSON.stringify(again)).not.toContain("kite-rush");
    expect((await artifacts.latest("kite-rush"))?.html).toBe("two!");
  });

  it("loads the newest draft for the run, or null", async () => {
    const tools = createCartridgeTools(new MemoryArtifactStore());
    const empty = await call<{ draft: unknown }>(
      tools.load_draft,
      {},
      contextFor("kite-rush", 0),
    );
    expect(empty.draft).toBeNull();
    await call(
      tools.save_draft,
      { html: "<p>saved</p>" },
      contextFor("kite-rush", 0),
    );
    const loaded = await call<{ draft: { version: string; html: string } }>(
      tools.load_draft,
      {},
      contextFor("kite-rush", 1),
    );
    expect(loaded.draft).toEqual({ version: "a0", html: "<p>saved</p>" });
  });

  it("refuses a page above MAX_GAME_BYTES", async () => {
    const tools = createCartridgeTools(new MemoryArtifactStore());
    const result = await call<{ error?: boolean }>(
      tools.save_draft,
      { html: "x".repeat(MAX_GAME_BYTES + 1) },
      contextFor("kite-rush", 0),
    );
    expect(result.error).toBe(true);
  });

  it("fails loudly without a run context", async () => {
    const tools = createCartridgeTools(new MemoryArtifactStore());
    await expect(call(tools.save_draft, { html: "x" }, {})).rejects.toThrow(
      /runKey/,
    );
  });
});

describe("verify tool", () => {
  it("returns the E1 verdict for a page", async () => {
    const verdict = await call<{ ok: boolean; errors: unknown[] }>(verifyTool, {
      html: MOCK_GAME_HTML,
    });
    expect(verdict.ok).toBe(true);
    const broken = await call<{ ok: boolean; errors: { ruleId: string }[] }>(
      verifyTool,
      { html: "<p>no</p>" },
    );
    expect(broken.ok).toBe(false);
    expect(broken.errors.map((finding) => finding.ruleId)).toContain("E1-01");
  });
});
