import type { ArtifactStore } from "../artifacts/types.ts";
import { getCardTool } from "./get-card.ts";
import { listCardsTool } from "./list-cards.ts";
import { loadDraftTool } from "./load-draft.ts";
import { saveDraftTool } from "./save-draft.ts";

export { verifyTool } from "./verify.ts";

/**
 * Builds the run's tools; the draft tools close over this run's artifact store (§4.6). Keys equal
 * ids, because the key is the name the model sees.
 * @param artifacts the run's artifact store
 */
export function createCartridgeTools(artifacts: ArtifactStore) {
  return {
    list_cards: listCardsTool,
    get_card: getCardTool,
    load_draft: loadDraftTool(artifacts),
    save_draft: saveDraftTool(artifacts),
  };
}

export type CartridgeTools = ReturnType<typeof createCartridgeTools>;
