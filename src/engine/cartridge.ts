import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { InMemoryStore } from "@mastra/core/storage";
import { RunScopedArtifacts } from "./artifacts/scoped.ts";
import type { ArtifactStore } from "./artifacts/types.ts";
import { e1Verify, type VerifyFn } from "./phases/verify.ts";
import { loadPrompt } from "./prompts/index.ts";
import { createCartridgeTools } from "./tools/index.ts";
import {
  WORKFLOW_ID,
  buildCartridgeWorkflow,
  type CartridgeWorkflow,
} from "./workflow.ts";

export type { VerifyFn };

/** Retries are the driver's job (§5), so the agents never retry a model call themselves. */
const AGENT_MAX_RETRIES = 0;

export interface CartridgeDeps {
  readonly models: {
    readonly planner: MastraModelConfig;
    readonly builder: MastraModelConfig;
  };
  readonly artifacts: ArtifactStore;
  /** Scorer override for tests; the default is E1. */
  readonly verify?: VerifyFn;
}

export interface Cartridge {
  readonly mastra: Mastra;
  readonly workflow: CartridgeWorkflow;
}

/**
 * Builds a fresh Mastra instance for one run (§4.6): agents on this run's models, tools closed over
 * a view of the artifact store that sees only this run's saves, and in-memory Mastra storage. No per-run state lives at module level.
 * @param deps models, artifact store and optional scorer
 */
export function createCartridge(deps: CartridgeDeps): Cartridge {
  const artifacts = new RunScopedArtifacts(deps.artifacts);
  const tools = createCartridgeTools(artifacts);
  const planner = new Agent({
    id: "planner",
    name: "planner",
    instructions: loadPrompt("planner"),
    model: deps.models.planner,
    tools: { list_cards: tools.list_cards, get_card: tools.get_card },
    maxRetries: AGENT_MAX_RETRIES,
  });
  const builder = new Agent({
    id: "builder",
    name: "builder",
    instructions: loadPrompt("builder"),
    model: deps.models.builder,
    tools: {
      get_card: tools.get_card,
      load_draft: tools.load_draft,
      save_draft: tools.save_draft,
    },
    maxRetries: AGENT_MAX_RETRIES,
  });
  const workflow = buildCartridgeWorkflow({
    planner,
    builder,
    artifacts,
    verify: deps.verify ?? e1Verify,
  });
  const mastra = new Mastra({
    agents: { planner, builder },
    workflows: { [WORKFLOW_ID]: workflow },
    storage: new InMemoryStore(),
    logger: false,
  });
  return { mastra, workflow: mastra.getWorkflow(WORKFLOW_ID) };
}
