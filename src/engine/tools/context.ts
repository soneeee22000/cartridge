import type { RequestContext } from "@mastra/core/request-context";
import { CartridgeContext } from "../schemas.ts";

/**
 * Reads the run's identity from the request context. `runKey` and `buildAttempt` never come from
 * model input (§4.3).
 * @param requestContext the context Mastra hands to a tool
 */
export function readCartridgeContext(
  requestContext: RequestContext | undefined,
): CartridgeContext {
  const parsed = CartridgeContext.safeParse({
    runKey: requestContext?.get("runKey"),
    claimAttempt: requestContext?.get("claimAttempt"),
    buildAttempt: requestContext?.get("buildAttempt"),
  });
  if (!parsed.success)
    throw new Error(
      "tool called without a cartridge request context (runKey, claimAttempt, buildAttempt)",
    );
  return parsed.data;
}
