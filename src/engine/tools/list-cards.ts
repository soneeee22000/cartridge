import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CardKind, listCards } from "../../cards/index.ts";

/** `list_cards`: card front matter, sorted by id, optionally filtered by kind (§4.3). */
export const listCardsTool = createTool({
  id: "list_cards",
  description:
    "List the knowledge cards (id, kind, title, summary), sorted by id. Pass a kind to filter.",
  inputSchema: z.object({ kind: CardKind.optional() }),
  outputSchema: z.object({
    cards: z.array(
      z.object({
        id: z.string(),
        kind: CardKind,
        title: z.string(),
        summary: z.string(),
      }),
    ),
  }),
  execute: ({ kind }) => {
    const cards = listCards()
      .filter((card) => kind === undefined || card.kind === kind)
      .map(({ id, kind: cardKind, title, summary }) => ({
        id,
        kind: cardKind,
        title,
        summary,
      }));
    return Promise.resolve({ cards });
  },
});
