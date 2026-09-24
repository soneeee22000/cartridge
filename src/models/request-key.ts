import { createHash } from "node:crypto";

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A request body carried a value that changes between runs, so it cannot be a stable key. */
export class VolatileValueError extends Error {
  override readonly name = "VolatileValueError";
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, inner]) => inner !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, inner]) => [key, canonicalValue(inner)] as const);
  return Object.fromEntries(entries);
}

/**
 * Serialises JSON with keys sorted recursively and `undefined` values dropped.
 * @param value any JSON-compatible value
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/**
 * The cassette key for a request: sha256 of the canonical `{ url, body }`. Headers never count.
 * @param url request pathname
 * @param body parsed request body
 */
export function requestKey(url: string, body: unknown): string {
  const digest = createHash("sha256")
    .update(canonicalJson({ url, body }))
    .digest("hex");
  return `sha256:${digest}`;
}

/**
 * Throws when a UUID or an ISO timestamp appears anywhere in the body (§7.2).
 * @param body parsed request body
 */
export function assertNoVolatile(body: unknown): void {
  const text = JSON.stringify(body);
  if (UUID_PATTERN.test(text))
    throw new VolatileValueError("volatile value in request body: a UUID");
  if (ISO_TIMESTAMP_PATTERN.test(text))
    throw new VolatileValueError(
      "volatile value in request body: an ISO timestamp",
    );
}
