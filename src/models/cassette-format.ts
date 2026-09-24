import { z } from "zod";
import { Usage } from "../engine/usage.ts";

export const CASSETTE_FORMAT = "cartridge-cassette/1";
/** Price table the cassette's usage was recorded against (§11.4). */
export const PRICE_TABLE_VERSION = "2026-09-24";
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/** One recorded model call (§7.3). Headers are never stored. */
export const Cassette = z.object({
  format: z.literal(CASSETTE_FORMAT),
  key: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  occurrence: z.int().min(0),
  role: z.enum(["planner", "builder", "judge"]),
  model: z.string().min(1),
  request: z.object({ url: z.string().startsWith("/"), body: z.unknown() }),
  response: z.object({
    status: z.int().min(HTTP_OK_MIN).max(HTTP_OK_MAX),
    contentType: z.literal("text/event-stream"),
    body: z.string(),
    gapsMs: z.array(z.number().min(0)),
  }),
  usage: Usage,
  priceTableVersion: z.string(),
});
export type Cassette = z.infer<typeof Cassette>;

/** `index.json`: cassette file stems in call order. */
export const CassetteIndex = z.object({ keys: z.array(z.string()) });
export type CassetteIndex = z.infer<typeof CassetteIndex>;
