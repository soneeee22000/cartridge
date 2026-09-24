import type { LanguageModelV4 } from "@ai-sdk/provider";
import { MemoryArtifactStore } from "../../src/engine/artifacts/memory.ts";
import type { ArtifactStore } from "../../src/engine/artifacts/types.ts";
import { createCartridge, type VerifyFn } from "../../src/engine/cartridge.ts";
import {
  mapWorkflowChunk,
  type ProgressEvent,
} from "../../src/engine/events.ts";
import { RunOutput, type RunInput } from "../../src/engine/schemas.ts";
import { startCartridgeRun } from "../../src/engine/workflow-port.ts";
import {
  MOCK_GAME_HTML,
  MOCK_SPEC,
  scriptedTurns,
  type Turn,
} from "../../src/models/mock.ts";

/** A game that fails only E1-13 (no `start` event). */
export const BROKEN_GAME_HTML = MOCK_GAME_HTML.replace(
  'CARTRIDGE.send("start");',
  "",
);

export const saveTurn = (
  html: string,
  usage?: { input: number; output: number },
): Turn =>
  usage
    ? { kind: "tool", tool: "save_draft", input: { html }, usage }
    : { kind: "tool", tool: "save_draft", input: { html } };
export const doneTurn: Turn = { kind: "text", text: "Saved." };
export const planTurn = (spec: object = MOCK_SPEC): Turn => ({
  kind: "text",
  text: JSON.stringify(spec),
});

export interface RunOptions {
  readonly planner?: LanguageModelV4;
  readonly builder?: LanguageModelV4;
  readonly plannerTurns?: readonly Turn[];
  readonly builderTurns?: readonly Turn[];
  readonly artifacts?: ArtifactStore;
  readonly verify?: VerifyFn;
  readonly input?: Partial<RunInput>;
}

export interface RunResult {
  readonly status: string;
  readonly output: RunOutput | null;
  readonly events: ProgressEvent[];
  readonly chunkTypes: string[];
  readonly artifacts: ArtifactStore;
}

/**
 * Runs the real workflow once with scripted models and collects the mapped progress events.
 * @param options scripts, stores and input overrides
 */
export async function runWorkflow(options: RunOptions): Promise<RunResult> {
  const artifacts = options.artifacts ?? new MemoryArtifactStore();
  const cartridge = createCartridge({
    models: {
      planner:
        options.planner ?? scriptedTurns(options.plannerTurns ?? [planTurn()]),
      builder:
        options.builder ??
        scriptedTurns(
          options.builderTurns ?? [saveTurn(MOCK_GAME_HTML), doneTurn],
        ),
    },
    artifacts,
    ...(options.verify ? { verify: options.verify } : {}),
  });
  const input: RunInput = {
    runKey: "lantern-dash",
    prompt: "A lantern that floats up the street and the player dodges tiles",
    ...options.input,
  };
  const handle = await startCartridgeRun(cartridge, input, {
    runKey: input.runKey,
    claimAttempt: 1,
    buildAttempt: 0,
  });
  const events: ProgressEvent[] = [];
  const chunkTypes: string[] = [];
  for await (const chunk of handle.fullStream) {
    chunkTypes.push((chunk as { type: string }).type);
    events.push(...mapWorkflowChunk(chunk));
  }
  const result = (await handle.result) as { status: string; result?: unknown };
  const output =
    result.status === "success" ? RunOutput.parse(result.result) : null;
  return { status: result.status, output, events, chunkTypes, artifacts };
}

/**
 * The kinds of the events, in order.
 * @param events progress events
 */
export function kinds(events: readonly ProgressEvent[]): string[] {
  return events.map((event) => event.kind);
}
