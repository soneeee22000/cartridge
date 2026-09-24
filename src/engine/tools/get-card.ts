import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CARD_IDS, getCard } from "../../cards/index.ts";

const [FIRST_CARD, ...OTHER_CARDS] = CARD_IDS;
const CardId = z.enum([FIRST_CARD ?? "bridge", ...OTHER_CARDS]);

/** `get_card`: one card body by id; an unknown id is a validation error the model sees (§4.3). */
export const getCardTool = createTool({
  id: "get_card",
  description: "Read one knowledge card by id.",
  inputSchema: z.object({ id: CardId }),
  outputSchema: z.object({ id: z.string(), body: z.string() }),
  execute: ({ id }) => Promise.resolve({ id, body: getCard(id).body }),
});
