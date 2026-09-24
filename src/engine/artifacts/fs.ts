import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RunKey, type ArtifactRef } from "../schemas.ts";
import {
  refFor,
  versionOf,
  type ArtifactStore,
  type StoredArtifact,
} from "./types.ts";

const VERSIONS_FILE = "versions.json";

const VersionEntry = z.object({
  version: z.string().regex(/^a\d+$/),
  sha256: z.string(),
  bytes: z.int().min(0),
});
const Versions = z.object({ versions: z.array(VersionEntry) });
type VersionEntry = z.infer<typeof VersionEntry>;

function attemptOf(version: string): number {
  return Number(version.slice(1));
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes `games/<runKey>/a<n>.html` plus `versions.json` before `put` resolves (§4.3), so a crash
 * never loses a page generated in the current claim. Saves to one run key are serialised inside
 * the process, so overlapping saves cannot drop a `versions.json` entry. A later claim of the same
 * run restarts at `a0` and replaces the earlier claim's drafts; only one open run per run key is
 * allowed (§5.3), so two runs never share a directory at once.
 */
export class FsArtifactStore implements ArtifactStore {
  readonly root: string;
  readonly #writes = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.root = root;
  }

  #runDir(runKey: string): string {
    return join(this.root, RunKey.parse(runKey));
  }

  async #versions(runKey: string): Promise<VersionEntry[]> {
    const raw = await readOrNull(join(this.#runDir(runKey), VERSIONS_FILE));
    return raw === null ? [] : Versions.parse(JSON.parse(raw)).versions;
  }

  /** @inheritdoc */
  put(
    runKey: string,
    buildAttempt: number,
    html: string,
  ): Promise<ArtifactRef> {
    const previous = this.#writes.get(runKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.#write(runKey, buildAttempt, html));
    this.#writes.set(runKey, next);
    void next
      .finally(() => {
        if (this.#writes.get(runKey) === next) this.#writes.delete(runKey);
      })
      .catch(() => undefined);
    return next;
  }

  async #write(
    runKey: string,
    buildAttempt: number,
    html: string,
  ): Promise<ArtifactRef> {
    const dir = this.#runDir(runKey);
    const ref = refFor(runKey, buildAttempt, html);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ref.version}.html`), html);
    const others = (await this.#versions(runKey)).filter(
      (entry) => entry.version !== ref.version,
    );
    const entry = {
      version: ref.version,
      sha256: ref.sha256,
      bytes: ref.bytes,
    };
    const versions = [...others, entry].sort(
      (left, right) => attemptOf(left.version) - attemptOf(right.version),
    );
    await writeFile(
      join(dir, VERSIONS_FILE),
      `${JSON.stringify({ versions }, null, 2)}\n`,
    );
    return ref;
  }

  /** @inheritdoc */
  async latest(runKey: string): Promise<StoredArtifact | null> {
    const newest = (await this.#versions(runKey)).at(-1);
    if (!newest) return null;
    const ref: ArtifactRef = {
      runKey,
      buildAttempt: attemptOf(newest.version),
      version: newest.version,
      sha256: newest.sha256,
      bytes: newest.bytes,
    };
    const html = await readOrNull(
      join(this.#runDir(runKey), `${newest.version}.html`),
    );
    return html === null ? null : { ref, html };
  }

  /** @inheritdoc */
  async get(ref: ArtifactRef): Promise<string | null> {
    const path = join(
      this.#runDir(ref.runKey),
      `${versionOf(ref.buildAttempt)}.html`,
    );
    const html = await readOrNull(path);
    if (html === null) return null;
    const matches =
      refFor(ref.runKey, ref.buildAttempt, html).sha256 === ref.sha256;
    return matches ? html : null;
  }
}
