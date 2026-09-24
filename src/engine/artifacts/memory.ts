import { RunKey, type ArtifactRef } from "../schemas.ts";
import { refFor, type ArtifactStore, type StoredArtifact } from "./types.ts";

/** In-process artifact store, used on Vercel and in tests (§4.3). */
export class MemoryArtifactStore implements ArtifactStore {
  readonly #runs = new Map<string, Map<number, StoredArtifact>>();

  #put(runKey: string, buildAttempt: number, html: string): ArtifactRef {
    const ref = refFor(RunKey.parse(runKey), buildAttempt, html);
    const attempts =
      this.#runs.get(runKey) ?? new Map<number, StoredArtifact>();
    attempts.set(buildAttempt, { ref, html });
    this.#runs.set(runKey, attempts);
    return ref;
  }

  /** @inheritdoc */
  put(
    runKey: string,
    buildAttempt: number,
    html: string,
  ): Promise<ArtifactRef> {
    return Promise.resolve().then(() => this.#put(runKey, buildAttempt, html));
  }

  /** @inheritdoc */
  latest(runKey: string): Promise<StoredArtifact | null> {
    const attempts = this.#runs.get(runKey);
    if (!attempts || attempts.size === 0) return Promise.resolve(null);
    const newest = Math.max(...attempts.keys());
    return Promise.resolve(attempts.get(newest) ?? null);
  }

  /** @inheritdoc */
  get(ref: ArtifactRef): Promise<string | null> {
    const stored = this.#runs.get(ref.runKey)?.get(ref.buildAttempt);
    const matches = stored?.ref.sha256 === ref.sha256;
    return Promise.resolve(matches ? stored.html : null);
  }
}
