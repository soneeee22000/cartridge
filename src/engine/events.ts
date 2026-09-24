import { z } from "zod";
import { GameSpec } from "../contract/spec.ts";
import { Attribution } from "./schemas.ts";
import { Usage } from "./usage.ts";

/** Custom chunk type every engine progress event travels under (§6.1). */
export const CARTRIDGE_CHUNK = "data-cartridge";

const event = <K extends string, D extends z.ZodType>(kind: K, data: D) =>
  z.object({ kind: z.literal(kind), data });

const Phase = z.enum(["generate", "verify"]);
const BuildAttempt = z.int().min(0);

/** Events the engine emits from inside the workflow as `data-cartridge` chunks. */
export const CartridgeData = z.discriminatedUnion("kind", [
  event("phase.start", z.object({ phase: Phase, buildAttempt: BuildAttempt })),
  event(
    "plan.spec",
    z.object({ spec: GameSpec, langSource: z.enum(["detector", "planner"]) }),
  ),
  event(
    "tool.call",
    z.object({ phase: z.enum(["plan", "generate"]), tool: z.string() }),
  ),
  event(
    "verify.verdict",
    z.object({
      buildAttempt: BuildAttempt,
      ok: z.boolean(),
      score: z.number(),
      errors: z.array(z.string()),
    }),
  ),
  event(
    "repair.start",
    z.object({ buildAttempt: BuildAttempt, fromRules: z.array(z.string()) }),
  ),
  event(
    "usage",
    z.object({
      phase: z.enum(["plan", "generate"]),
      buildAttempt: BuildAttempt,
      usage: Usage,
    }),
  ),
]);
export type CartridgeData = z.infer<typeof CartridgeData>;

const StepStart = event("step.start", z.object({ step: z.string() }));
const StepResult = event(
  "step.result",
  z.object({ step: z.string(), status: z.string() }),
);
const RunClaimed = event(
  "run.claimed",
  z.object({ claimAttempt: z.int().min(1) }),
);
const RunReleased = event(
  "run.released",
  z.object({ attribution: Attribution }),
);

/** Everything persisted in `run_events` (§6.1). */
export const ProgressEvent = z.union([
  CartridgeData,
  StepStart,
  StepResult,
  RunClaimed,
  RunReleased,
]);
export type ProgressEvent = z.infer<typeof ProgressEvent>;

/** An event as stored, with its per-run sequence number. */
export interface StoredEvent {
  readonly seq: number;
  readonly at: number;
  readonly event: ProgressEvent;
}

/** `event: terminal`, built only from the run row (§6.1). */
export const TerminalEvent = z.object({
  status: z.enum(["complete", "abandoned"]),
  artifact: z
    .object({ version: z.string(), sha256: z.string(), html: z.string() })
    .optional(),
  e1Score: z.number().optional(),
  attribution: Attribution.optional(),
});
export type TerminalEvent = z.infer<typeof TerminalEvent>;

const StepChunk = z.object({
  type: z.enum(["workflow-step-start", "workflow-step-result"]),
  payload: z.object({ id: z.string(), status: z.string().optional() }),
});
const DataChunk = z.object({
  type: z.literal(CARTRIDGE_CHUNK),
  data: z.unknown(),
});

function stepEvent(chunk: z.infer<typeof StepChunk>): ProgressEvent {
  const step = chunk.payload.id;
  if (step.includes("."))
    throw new Error(`nested step id in the workflow stream: ${step}`);
  if (chunk.type === "workflow-step-start")
    return { kind: "step.start", data: { step } };
  return {
    kind: "step.result",
    data: { step, status: chunk.payload.status ?? "unknown" },
  };
}

/**
 * Maps one workflow stream chunk to the progress events it carries. Step events come from the
 * top-level steps; per-phase progress comes from `data-cartridge` chunks.
 * @param chunk any chunk from `run.stream().fullStream`
 */
export function mapWorkflowChunk(chunk: unknown): ProgressEvent[] {
  const data = DataChunk.safeParse(chunk);
  if (data.success) return [CartridgeData.parse(data.data.data)];
  const step = StepChunk.safeParse(chunk);
  if (step.success) return [stepEvent(step.data)];
  return [];
}
