import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsArtifactStore } from "../../src/engine/artifacts/fs.ts";
import { MemoryArtifactStore } from "../../src/engine/artifacts/memory.ts";
import { RunScopedArtifacts } from "../../src/engine/artifacts/scoped.ts";
import type { ArtifactStore } from "../../src/engine/artifacts/types.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fsStore(): { store: FsArtifactStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), "games-"));
  dirs.push(root);
  return { store: new FsArtifactStore(root), root };
}

const implementations: [string, () => ArtifactStore][] = [
  ["memory", () => new MemoryArtifactStore()],
  ["fs", () => fsStore().store],
];

describe.each(implementations)("%s artifact store (§4.3)", (_name, make) => {
  it("versions each build attempt as a<n> with sha256 and byte count", async () => {
    const store = make();
    const ref = await store.put("kite-rush", 0, "<p>é</p>");
    expect(ref).toMatchObject({
      runKey: "kite-rush",
      buildAttempt: 0,
      version: "a0",
      bytes: 9,
    });
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.get(ref)).toBe("<p>é</p>");
  });

  it("overwrites a second save in the same build attempt", async () => {
    const store = make();
    await store.put("kite-rush", 1, "first");
    const second = await store.put("kite-rush", 1, "second");
    const latest = await store.latest("kite-rush");
    expect(latest?.ref).toEqual(second);
    expect(latest?.html).toBe("second");
  });

  it("returns the newest build attempt as latest, and null for an unknown run", async () => {
    const store = make();
    await store.put("kite-rush", 0, "zero");
    await store.put("kite-rush", 2, "two");
    await store.put("other-run", 5, "else");
    expect((await store.latest("kite-rush"))?.ref.version).toBe("a2");
    expect(await store.latest("missing")).toBeNull();
  });
});

describe("FsArtifactStore", () => {
  it("writes the page and a sorted versions.json the moment put returns", async () => {
    const { store, root } = fsStore();
    await store.put("kite-rush", 10, "ten");
    await store.put("kite-rush", 2, "two");
    expect(readFileSync(join(root, "kite-rush", "a10.html"), "utf8")).toBe(
      "ten",
    );
    const versions = JSON.parse(
      readFileSync(join(root, "kite-rush", "versions.json"), "utf8"),
    ) as { versions: { version: string }[] };
    expect(versions.versions.map((entry) => entry.version)).toEqual([
      "a2",
      "a10",
    ]);
  });

  it("rejects a run key that could escape the root", async () => {
    const { store } = fsStore();
    await expect(store.put("../escape", 0, "x")).rejects.toThrow();
  });
});

describe("run-scoped artifact view (§4.3, §4.6)", () => {
  it("hides drafts an earlier run left in the shared store", async () => {
    const shared = new MemoryArtifactStore();
    const earlier = await shared.put("kite-rush", 0, "<p>earlier</p>");
    const scoped = new RunScopedArtifacts(shared);
    expect(await scoped.latest("kite-rush")).toBeNull();
    expect(await scoped.get(earlier)).toBeNull();
    const own = await scoped.put("kite-rush", 0, "<p>own</p>");
    expect(await scoped.latest("kite-rush")).toEqual({
      ref: own,
      html: "<p>own</p>",
    });
    expect(await shared.get(own)).toBe("<p>own</p>");
    expect(await scoped.get(earlier)).toBeNull();
  });

  it("returns the newest attempt this run saved", async () => {
    const scoped = new RunScopedArtifacts(new MemoryArtifactStore());
    await scoped.put("kite-rush", 0, "<p>zero</p>");
    await scoped.put("kite-rush", 1, "<p>one</p>");
    expect((await scoped.latest("kite-rush"))?.ref.version).toBe("a1");
  });
});
