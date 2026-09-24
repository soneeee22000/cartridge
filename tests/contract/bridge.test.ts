import { describe, expect, it } from "vitest";
import {
  BRIDGE_SOURCE,
  BRIDGE_VERSION,
  GameEnvelope,
  HOST_SOURCE,
  HostCommand,
} from "../../src/contract/bridge.ts";

const envelope = (type: string, payload: unknown) => ({
  source: BRIDGE_SOURCE,
  v: BRIDGE_VERSION,
  type,
  payload,
});

describe("GameEnvelope (§2.1)", () => {
  it("accepts a well-formed boot event", () => {
    const parsed = GameEnvelope.safeParse(
      envelope("boot", {
        title: "Kite Rush",
        gameType: "arcade-run",
        lang: "en",
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects boot with an unknown game type", () => {
    const parsed = GameEnvelope.safeParse(
      envelope("boot", {
        title: "Kite Rush",
        gameType: "free-play",
        lang: "en",
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("accepts start with an empty payload", () => {
    expect(GameEnvelope.safeParse(envelope("start", {})).success).toBe(true);
  });

  it("requires a non-negative integer score", () => {
    expect(
      GameEnvelope.safeParse(envelope("score", { value: 12 })).success,
    ).toBe(true);
    expect(
      GameEnvelope.safeParse(envelope("score", { value: -1 })).success,
    ).toBe(false);
    expect(
      GameEnvelope.safeParse(envelope("score", { value: 1.5 })).success,
    ).toBe(false);
    expect(
      GameEnvelope.safeParse(envelope("score", { value: "3" })).success,
    ).toBe(false);
  });

  it("requires a level index of at least 1", () => {
    expect(
      GameEnvelope.safeParse(envelope("level", { index: 1 })).success,
    ).toBe(true);
    expect(
      GameEnvelope.safeParse(envelope("level", { index: 0 })).success,
    ).toBe(false);
  });

  it("accepts end with a known reason and optional value", () => {
    expect(
      GameEnvelope.safeParse(envelope("end", { reason: "win" })).success,
    ).toBe(true);
    expect(
      GameEnvelope.safeParse(envelope("end", { reason: "lose", value: 40 }))
        .success,
    ).toBe(true);
    expect(
      GameEnvelope.safeParse(envelope("end", { reason: "quit" })).success,
    ).toBe(false);
  });

  it("rejects a message from another source or version", () => {
    const foreign = { ...envelope("start", {}), source: "someone-else" };
    const future = { ...envelope("start", {}), v: 2 };
    expect(GameEnvelope.safeParse(foreign).success).toBe(false);
    expect(GameEnvelope.safeParse(future).success).toBe(false);
  });
});

describe("HostCommand (§2.1)", () => {
  it("accepts pause, resume and reset from the host source", () => {
    for (const type of ["pause", "resume", "reset"]) {
      expect(HostCommand.safeParse({ source: HOST_SOURCE, type }).success).toBe(
        true,
      );
    }
  });

  it("rejects unknown commands", () => {
    expect(
      HostCommand.safeParse({ source: HOST_SOURCE, type: "restart" }).success,
    ).toBe(false);
  });
});
