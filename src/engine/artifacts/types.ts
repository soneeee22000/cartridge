import { createHash } from "node:crypto";
import type { ArtifactRef } from "../schemas.ts";

export type { ArtifactRef };

/** A stored page with its reference. */
export interface StoredArtifact {
  readonly ref: ArtifactRef;
  readonly html: string;
}

/**
 * Versioned artifact store (§4.3). `put` is idempotent per `(runKey, buildAttempt)`: a second save
 * in the same build attempt overwrites the first.
 */
export interface ArtifactStore {
  put(runKey: string, buildAttempt: number, html: string): Promise<ArtifactRef>;
  latest(runKey: string): Promise<StoredArtifact | null>;
  get(ref: ArtifactRef): Promise<string | null>;
}

/**
 * The version label for a build attempt.
 * @param buildAttempt zero-based build attempt
 */
export function versionOf(buildAttempt: number): string {
  return `a${buildAttempt}`;
}

/**
 * Builds the reference for a page without storing it.
 * @param runKey run key
 * @param buildAttempt zero-based build attempt
 * @param html page source
 */
export function refFor(
  runKey: string,
  buildAttempt: number,
  html: string,
): ArtifactRef {
  return {
    runKey,
    buildAttempt,
    version: versionOf(buildAttempt),
    sha256: createHash("sha256").update(html).digest("hex"),
    bytes: Buffer.byteLength(html, "utf8"),
  };
}
