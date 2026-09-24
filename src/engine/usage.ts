import { z } from "zod";

const TokenCount = z.int().min(0);

/** Token usage in four disjoint kinds (§4.4). */
export const Usage = z.object({
  input: TokenCount,
  output: TokenCount,
  cacheRead: TokenCount,
  cacheWrite: TokenCount,
});
export type Usage = z.infer<typeof Usage>;

export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/** The normalised usage fields an agent call reports (`totalUsage`). `raw` is never read. */
export interface ProviderUsage {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly cacheCreationInputTokens?: number | undefined;
}

/**
 * Maps provider usage to disjoint kinds. `inputTokens` already includes cache reads and cache
 * writes, so both are subtracted to get the uncached input.
 * @param usage normalised provider usage
 */
export function toUsage(usage: ProviderUsage): Usage {
  const cacheRead = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const input = Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  return { input, output: usage.outputTokens ?? 0, cacheRead, cacheWrite };
}

/**
 * Adds two usages kind by kind.
 * @param left first usage
 * @param right second usage
 */
export function addUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  };
}

/**
 * Sums all four kinds; budgets are enforced on this number.
 * @param usage usage to total
 */
export function totalTokens(usage: Usage): number {
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
