import { RequestContext } from "@mastra/core/request-context";
import type { Cartridge } from "./cartridge.ts";
import type { CartridgeContext, RunInput } from "./schemas.ts";

/** What the driver needs from a running workflow (§5.4). Tests pass hand-made iterables. */
export interface WorkflowHandle {
  readonly fullStream: AsyncIterable<unknown>;
  readonly result: Promise<unknown>;
  cancel(): Promise<void>;
}

/** Starts one workflow run for a claimed row. */
export type StartWorkflowStream = (
  input: RunInput,
  context: CartridgeContext,
) => Promise<WorkflowHandle>;

/**
 * Builds the typed request context the steps and tools read.
 * @param context run key, claim attempt and build attempt
 */
export function cartridgeRequestContext(
  context: CartridgeContext,
): RequestContext<CartridgeContext> {
  const requestContext = new RequestContext<CartridgeContext>();
  requestContext.set("runKey", context.runKey);
  requestContext.set("claimAttempt", context.claimAttempt);
  requestContext.set("buildAttempt", context.buildAttempt);
  return requestContext;
}

/**
 * Starts a streamed run on a cartridge.
 * @param cartridge a cartridge built for this run
 * @param input run key and prompt
 * @param context request context values
 */
export async function startCartridgeRun(
  cartridge: Cartridge,
  input: RunInput,
  context: CartridgeContext,
): Promise<WorkflowHandle> {
  const run = await cartridge.workflow.createRun();
  const output = run.stream({
    inputData: input,
    requestContext: cartridgeRequestContext(context),
  });
  return {
    fullStream: output.fullStream,
    result: output.result,
    cancel: () => run.cancel(),
  };
}

/**
 * The real `startWorkflowStream` port: a fresh cartridge per run.
 * @param makeCartridge builds the cartridge for a run (models, artifact store)
 */
export function cartridgePort(
  makeCartridge: (input: RunInput) => Cartridge,
): StartWorkflowStream {
  return (input, context) =>
    startCartridgeRun(makeCartridge(input), input, context);
}
