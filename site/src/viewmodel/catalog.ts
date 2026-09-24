import type { Report } from "../types/report";

/** One replayable prompt, as `GET /api/prompts` returns it. */
export interface CatalogEntry {
  readonly id: string;
  readonly lang: string;
  readonly lengthBand: string;
  readonly prompt: string;
  readonly buildAttempts: number;
}

/** A dataset item as `dataset/prompts.v1.json` stores it (the fields this page reads). */
export interface DatasetItem {
  readonly id: string;
  readonly lang: string;
  readonly lengthBand: string;
  readonly prompt: string;
}

/** Where the picker's list came from. */
export type CatalogSource = "api" | "bundled";

const ID_PATTERN = /^[a-z0-9-]{3,40}$/;

/** Read one entry from untrusted JSON, or null when any field is missing or malformed. */
function parseEntry(value: unknown): CatalogEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Readonly<Record<string, unknown>>;
  const { id, lang, lengthBand, prompt, buildAttempts } = record;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
  if (typeof lang !== "string" || typeof lengthBand !== "string") return null;
  if (typeof prompt !== "string" || typeof buildAttempts !== "number")
    return null;
  return { id, lang, lengthBand, prompt, buildAttempts };
}

/** Parse the `/api/prompts` body; null when it is not a non-empty list of valid entries. */
export function parseCatalog(body: unknown): CatalogEntry[] | null {
  if (typeof body !== "object" || body === null) return null;
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const entries = items.map(parseEntry);
  if (entries.some((entry) => entry === null)) return null;
  return entries.filter((entry): entry is CatalogEntry => entry !== null);
}

/**
 * The same list the server builds (`loadReplayCatalog`): dataset items with a recorded run, with
 * repaired items first and dataset order kept otherwise. Used when `/api/prompts` cannot be reached.
 */
export function buildCatalog(
  items: readonly DatasetItem[],
  report: Report,
): CatalogEntry[] {
  const attempts = new Map(
    report.items.map((item) => [item.id, item.buildAttempts]),
  );
  return items
    .filter((item) => (attempts.get(item.id) ?? 0) > 0)
    .map((item) => ({
      id: item.id,
      lang: item.lang,
      lengthBand: item.lengthBand,
      prompt: item.prompt,
      buildAttempts: attempts.get(item.id) ?? 0,
    }))
    .sort((a, b) => Number(b.buildAttempts > 1) - Number(a.buildAttempts > 1));
}

/** Whether the recorded run of this entry went through the repair loop. */
export function wasRepaired(entry: CatalogEntry): boolean {
  return entry.buildAttempts > 1;
}

/** The picker label: id, language, band and whether the recorded run repaired. */
export function optionLabel(entry: CatalogEntry): string {
  const repairs = entry.buildAttempts - 1;
  const outcome =
    repairs === 0
      ? "first pass"
      : `${String(repairs)} repair${repairs === 1 ? "" : "s"}`;
  return `${entry.id} (${entry.lang}, ${entry.lengthBand}, ${outcome})`;
}
