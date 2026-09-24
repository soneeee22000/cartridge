import { z } from "zod";
import { GameSpec } from "../contract/spec.ts";
import { Verdict } from "../eval/e1/score.ts";
import { Usage } from "./usage.ts";

/**
 * Typed step I/O (§4.2). Kept apart from `workflow.ts` so phases, steps and the driver can import
 * the schemas without importing the graph.
 */

const RUN_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RUN_KEY_MAX_CHARS = 80;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Dataset item id or demo id; never a random id. */
export const RunKey = z.string().max(RUN_KEY_MAX_CHARS).regex(RUN_KEY_PATTERN);

export const RunInput = z.object({ runKey: RunKey, prompt: z.string().min(1) });
export type RunInput = z.infer<typeof RunInput>;

export const ArtifactRef = z.object({
  runKey: RunKey,
  buildAttempt: z.int().min(0),
  version: z.string().regex(/^a\d+$/),
  sha256: z.string().regex(SHA256_PATTERN),
  bytes: z.int().min(0),
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

/** Every failure code in §4.5. */
export const FAILURE_CODES = [
  "plan-invalid-spec",
  "generate-no-artifact",
  "generate-truncated",
  "contract-unmet",
  "budget-exhausted",
  "verifier-crashed",
  "model-refusal",
  "model-error",
  "cassette-miss",
  "stream-cut",
  "lease-lost",
  "engine-crashed",
] as const;
export const FailureCode = z.enum(FAILURE_CODES);
export type FailureCode = z.infer<typeof FailureCode>;

export const StepFailure = z.object({
  step: z.enum(["plan", "generate", "verify-static"]),
  code: FailureCode,
  message: z.string(),
  retryable: z.boolean(),
});
export type StepFailure = z.infer<typeof StepFailure>;

export const Attribution = z.object({
  step: z.enum(["plan", "generate", "verify-static", "finalize", "driver"]),
  code: FailureCode,
  buildAttempt: z.int().min(0),
  ruleIds: z.array(z.string()),
  message: z.string(),
  retryable: z.boolean(),
});
export type Attribution = z.infer<typeof Attribution>;

export const AttemptRec = z.object({
  buildAttempt: z.int().min(0),
  mode: z.enum(["initial", "repair"]),
  artifact: ArtifactRef.nullable(),
  verdict: Verdict.nullable(),
  usage: Usage,
  finishReason: z.string().nullable(),
  repairOf: z.array(z.string()),
});
export type AttemptRec = z.infer<typeof AttemptRec>;

/** `spec` is null only when plan failed; the loop then passes straight through to reject. */
export const BuildState = z.object({
  runKey: RunKey,
  prompt: z.string(),
  spec: GameSpec.nullable(),
  langSource: z.enum(["detector", "planner"]),
  planUsage: Usage,
  buildAttempt: z.int().min(0),
  repairs: z.int().min(0),
  artifact: ArtifactRef.nullable(),
  verdict: Verdict.nullable(),
  failure: StepFailure.nullable(),
  runTokens: z.int().min(0),
  repairTokens: z.int().min(0),
  history: z.array(AttemptRec),
});
export type BuildState = z.infer<typeof BuildState>;

export const FinalizeOut = z.object({
  outcome: z.literal("passed"),
  spec: GameSpec,
  artifact: ArtifactRef,
  html: z.string(),
  verdict: Verdict,
  history: z.array(AttemptRec),
});
export type FinalizeOut = z.infer<typeof FinalizeOut>;

export const RejectOut = z.object({
  outcome: z.literal("rejected"),
  spec: GameSpec.nullable(),
  attribution: Attribution,
  history: z.array(AttemptRec),
});
export type RejectOut = z.infer<typeof RejectOut>;

export const RunOutput = z.object({
  finalize: FinalizeOut.optional(),
  reject: RejectOut.optional(),
});
export type RunOutput = z.infer<typeof RunOutput>;

export const CartridgeContext = z.object({
  runKey: RunKey,
  claimAttempt: z.int().min(0),
  buildAttempt: z.int().min(0),
});
export type CartridgeContext = z.infer<typeof CartridgeContext>;
