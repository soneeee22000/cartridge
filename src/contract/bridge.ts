import { z } from "zod";
import { EndReason, GameType } from "./game-types.ts";

/** `source` field on every game-to-host message. */
export const BRIDGE_SOURCE = "cartridge";
/** `source` field on every host-to-game command. */
export const HOST_SOURCE = "cartridge-host";
/** Protocol version carried as `v`. */
export const BRIDGE_VERSION = 1;

/** The helper every game includes verbatim (card `bridge`). */
export const CARTRIDGE_HELPER = `const CARTRIDGE = {
  send(type, payload = {}) {
    window.parent.postMessage(
      { source: "cartridge", v: 1, type, payload },
      "*",
    );
  },
};`;

const envelopeOf = <T extends string, P extends z.ZodType>(
  type: T,
  payload: P,
) =>
  z.object({
    source: z.literal(BRIDGE_SOURCE),
    v: z.literal(BRIDGE_VERSION),
    type: z.literal(type),
    payload,
  });

export const BootPayload = z.object({
  title: z.string().min(1),
  gameType: GameType,
  lang: z.string().min(1),
});
export const StartPayload = z.object({});
export const ScorePayload = z.object({ value: z.int().min(0) });
export const LevelPayload = z.object({ index: z.int().min(1) });
export const EndPayload = z.object({
  reason: EndReason,
  value: z.number().optional(),
});

/** Any game-to-host message, discriminated on `type` (§2.1). */
export const GameEnvelope = z.discriminatedUnion("type", [
  envelopeOf("boot", BootPayload),
  envelopeOf("start", StartPayload),
  envelopeOf("score", ScorePayload),
  envelopeOf("level", LevelPayload),
  envelopeOf("end", EndPayload),
]);
export type GameEnvelope = z.infer<typeof GameEnvelope>;

/** Host-to-game command names. */
export const HOST_COMMANDS = ["pause", "resume", "reset"] as const;

/** A host-to-game command (§2.1). */
export const HostCommand = z.object({
  source: z.literal(HOST_SOURCE),
  type: z.enum(HOST_COMMANDS),
});
export type HostCommand = z.infer<typeof HostCommand>;
