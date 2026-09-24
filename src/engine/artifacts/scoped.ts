import type { ArtifactRef } from "../schemas.ts";
import type { ArtifactStore, StoredArtifact } from "./types.ts";

/**
 * A view of a shared artifact store that only sees what this run saved. A persistent store keeps
 * drafts from earlier runs of the same run key; without this view the generate phase would take a
 * leftover `a<n>` for this attempt's save, and `load_draft` would show the builder another run's
 * draft.
 */
export class RunScopedArtifacts implements ArtifactStore {
  readonly #inner: ArtifactStore;
  readonly #saved = new Map<string, Map<number, ArtifactRef>>();

  /**
   * @param inner the shared store that holds the files
   */
  constructor(inner: ArtifactStore) {
    this.#inner = inner;
  }

  /** @inheritdoc */
  async put(
    runKey: string,
    buildAttempt: number,
    html: string,
  ): Promise<ArtifactRef> {
    const ref = await this.#inner.put(runKey, buildAttempt, html);
    const attempts = this.#saved.get(runKey) ?? new Map<number, ArtifactRef>();
    attempts.set(buildAttempt, ref);
    this.#saved.set(runKey, attempts);
    return ref;
  }

  /** @inheritdoc */
  async latest(runKey: string): Promise<StoredArtifact | null> {
    const attempts = this.#saved.get(runKey);
    if (!attempts || attempts.size === 0) return null;
    const ref = attempts.get(Math.max(...attempts.keys()));
    if (!ref) return null;
    const html = await this.#inner.get(ref);
    return html === null ? null : { ref, html };
  }

  /** @inheritdoc */
  get(ref: ArtifactRef): Promise<string | null> {
    const saved = this.#saved.get(ref.runKey)?.get(ref.buildAttempt);
    if (saved?.sha256 !== ref.sha256) return Promise.resolve(null);
    return this.#inner.get(ref);
  }
}
