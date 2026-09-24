import { readFileSync } from "node:fs";
import { z } from "zod";
import { classifyStrings } from "./match.ts";

/** Printed next to every E4 accuracy figure (§10.2). */
export const LABELLED_NOTE =
  "measured on 40 authored bundles; the thresholds were set on the same bundles";

const LABELLED_PATH = new URL("./labelled.json", import.meta.url);

export const LabelledBundle = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.enum(["en", "fr", "abstain-expected"]),
  hard: z.boolean(),
  strings: z.array(z.string().min(1)).min(1),
});
export type LabelledBundle = z.infer<typeof LabelledBundle>;

export const LabelledStats = z.object({
  bundles: z.int(),
  accuracy: z.number(),
  abstentionRate: z.number(),
  expectedAbstentionsHit: z.number(),
  wrongLanguage: z.int(),
});
/**
 * `accuracy`: share of `en`/`fr` bundles whose decided language equals the label (an abstention
 * is not correct). `abstentionRate`: share of `en`/`fr` bundles where E4 abstained.
 * `expectedAbstentionsHit`: share of `abstain-expected` bundles where it abstained.
 * `wrongLanguage`: bundles where it decided the other language.
 */
export type LabelledStats = z.infer<typeof LabelledStats>;

/** Reads and validates `labelled.json`. */
export function loadLabelledSet(): LabelledBundle[] {
  return z
    .array(LabelledBundle)
    .parse(JSON.parse(readFileSync(LABELLED_PATH, "utf8")));
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * Accuracy and abstention on the labelled set (§10.2). This is the only E4 accuracy the repo states.
 * @param bundles labelled bundles
 */
export function labelledSetStats(
  bundles: readonly LabelledBundle[],
): LabelledStats {
  const decided = bundles.map((bundle) => ({
    label: bundle.label,
    lang: classifyStrings(bundle.strings).lang,
  }));
  const graded = decided.filter(({ label }) => label !== "abstain-expected");
  const expected = decided.filter(({ label }) => label === "abstain-expected");
  const count = (
    rows: typeof decided,
    keep: (row: (typeof decided)[number]) => boolean,
  ) => rows.filter(keep).length;
  return {
    bundles: bundles.length,
    accuracy: share(
      count(graded, ({ label, lang }) => lang === label),
      graded.length,
    ),
    abstentionRate: share(
      count(graded, ({ lang }) => lang === "abstain"),
      graded.length,
    ),
    expectedAbstentionsHit: share(
      count(expected, ({ lang }) => lang === "abstain"),
      expected.length,
    ),
    wrongLanguage: count(
      graded,
      ({ label, lang }) => lang !== "abstain" && lang !== label,
    ),
  };
}
