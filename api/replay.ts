import { getCard } from "../src/cards/index.ts";
import { toNodeHandler } from "../src/server/node-adapter.ts";

/**
 * S1 placeholder for `GET /api/replay`: proves the deploy bundle can read a card at runtime (§13.3).
 * S5 replaces the body with the cassette-backed replay stream.
 * Takes no input yet; the request is ignored until S5.
 */
export function GET(): Response {
  const card = getCard("bridge");
  return Response.json({
    placeholder: true,
    card: card.id,
    title: card.title,
    lines: card.lines.length,
  });
}

export default toNodeHandler(GET);
