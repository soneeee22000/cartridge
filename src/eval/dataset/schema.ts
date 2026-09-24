import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GAME_TYPES, GameType } from "../../contract/game-types.ts";
import { privacyViolations } from "./privacy-guard.ts";

export const LENGTH_BANDS = [
  "terse",
  "short-brief",
  "full-brief",
  "edge",
] as const;
export const LengthBand = z.enum(LENGTH_BANDS);
export type LengthBand = z.infer<typeof LengthBand>;

export const DATASET_LANGS = ["en", "fr"] as const;
export const DatasetLang = z.enum(DATASET_LANGS);
export type DatasetLang = z.infer<typeof DatasetLang>;

/** The committed dataset file (§11.1). */
export const DATASET_PATH = fileURLToPath(
  new URL("../../../dataset/prompts.v1.json", import.meta.url),
);

export const DatasetItem = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,40}$/),
  lengthBand: LengthBand,
  lang: DatasetLang,
  prompt: z.string().min(1),
  intendedType: GameType.nullable(),
  probes: z.array(z.string().regex(/^[a-z]+(-[a-z]+)*$/)),
  origin: z.literal("authored"),
});
export type DatasetItem = z.infer<typeof DatasetItem>;

export const Dataset = z.object({
  version: z.literal("v1"),
  items: z.array(DatasetItem),
});
export type Dataset = z.infer<typeof Dataset>;

interface WordRange {
  readonly min: number;
  readonly max: number;
}

/** Word-count rule per band (§11.1). `edge` has no upper bound. */
export const BAND_WORDS: Readonly<Record<LengthBand, WordRange>> = {
  terse: { min: 1, max: 4 },
  "short-brief": { min: 5, max: 40 },
  "full-brief": { min: 41, max: 160 },
  edge: { min: 161, max: Number.POSITIVE_INFINITY },
};

/** Probes that make an `edge` item regardless of its length. */
export const EDGE_PROBES: readonly string[] = ["contradiction", "off-scope"];
/** Each game type must be the intended type of at least this many items. */
export const MIN_ITEMS_PER_TYPE = 2;

/**
 * Counts whitespace-separated words.
 * @param text any prose
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function wordProblem(item: DatasetItem): string | null {
  if (
    item.lengthBand === "edge" &&
    item.probes.some((probe) => EDGE_PROBES.includes(probe))
  )
    return null;
  const words = countWords(item.prompt);
  const range = BAND_WORDS[item.lengthBand];
  if (words >= range.min && words <= range.max) return null;
  return `${item.id}: ${words} words does not fit band ${item.lengthBand}`;
}

function duplicateProblems(items: readonly DatasetItem[]): string[] {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return [];
    }
    return [`duplicate id ${item.id}`];
  });
}

function languageProblems(items: readonly DatasetItem[]): string[] {
  return LENGTH_BANDS.flatMap((band) =>
    DATASET_LANGS.filter(
      (lang) =>
        !items.some((item) => item.lengthBand === band && item.lang === lang),
    ).map((lang) => `band ${band} has no ${lang} item`),
  );
}

function typeProblems(items: readonly DatasetItem[]): string[] {
  return GAME_TYPES.filter(
    (type) =>
      items.filter((item) => item.intendedType === type).length <
      MIN_ITEMS_PER_TYPE,
  ).map(
    (type) =>
      `game type ${type} is intended by fewer than ${MIN_ITEMS_PER_TYPE} items`,
  );
}

/**
 * Whole-dataset checks (§11.1): unique ids, word counts per band, both languages in every band,
 * and every game type intended at least twice.
 * @param dataset a schema-valid dataset
 * @returns problems, empty when the dataset is sound
 */
export function checkDataset(dataset: Dataset): string[] {
  const { items } = dataset;
  return [
    ...duplicateProblems(items),
    ...items.flatMap((item) => wordProblem(item) ?? []),
    ...languageProblems(items),
    ...typeProblems(items),
  ];
}

/**
 * Reads, parses, checks and privacy-guards a dataset file. Throws on any problem.
 * @param path dataset JSON path
 */
export function loadDataset(path: string): Dataset {
  const dataset = Dataset.parse(JSON.parse(readFileSync(path, "utf8")));
  const problems = [
    ...checkDataset(dataset),
    ...dataset.items.flatMap((item) =>
      privacyViolations(`${item.id} ${item.prompt}`).map(
        (reason) => `${item.id}: ${reason}`,
      ),
    ),
  ];
  if (problems.length > 0)
    throw new Error(`dataset ${path} is invalid:\n${problems.join("\n")}`);
  return dataset;
}
