import {
  CLEAN_ROOM_DENYLIST_SHA256,
  tokenHashes,
} from "../../../scripts/clean-room-scan.ts";

interface PrivacyPattern {
  readonly reason: string;
  readonly pattern: RegExp;
}

/** Things a dataset item must never contain (§11.1). */
const PRIVACY_PATTERNS: readonly PrivacyPattern[] = [
  { reason: "email address", pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { reason: "URL", pattern: /\b(?:https?:\/\/|www\.)\S+/i },
  {
    reason: "UUID",
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  },
  { reason: "ISO date", pattern: /\b\d{4}-\d{2}-\d{2}\b/ },
  { reason: "clock time", pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\b/ },
  { reason: "long digit run", pattern: /\d{8,}/ },
  { reason: "@handle", pattern: /(?:^|[^\w.])@\w+/ },
];

const DEFAULT_DENYLIST: ReadonlySet<string> = new Set(
  CLEAN_ROOM_DENYLIST_SHA256,
);

/**
 * Lists every privacy rule the text breaks: personal data shapes, volatile ids, and any token
 * (or adjacent token pair) whose sha256 is on the clean-room denylist (§11.1, §12.3).
 * @param text an item's id and prompt
 * @param denylist digests to reject; the clean-room denylist by default
 * @returns reasons, empty when the text is clean
 */
export function privacyViolations(
  text: string,
  denylist: ReadonlySet<string> = DEFAULT_DENYLIST,
): string[] {
  const reasons = PRIVACY_PATTERNS.filter(({ pattern }) =>
    pattern.test(text),
  ).map(({ reason }) => reason);
  const denied = [...tokenHashes(text)].some((digest) => denylist.has(digest));
  return denied ? [...reasons, "denylisted term"] : reasons;
}
