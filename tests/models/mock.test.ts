import { describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import { APICallError } from "@ai-sdk/provider";
import {
  MOCK_GAME_HTML,
  MOCK_SPEC,
  demoMockModels,
  scriptedTurns,
} from "../../src/models/mock.ts";
import { scoreGame } from "../../src/eval/e1/score.ts";
import { GameSpec } from "../../src/contract/spec.ts";

function agentWith(model: ReturnType<typeof scriptedTurns>): Agent {
  return new Agent({
    id: "probe",
    name: "probe",
    instructions: "test",
    model,
    maxRetries: 0,
  });
}

describe("scriptedTurns (§7.1)", () => {
  it("plays text turns in order with the scripted finish reason", async () => {
    const model = scriptedTurns([
      { kind: "text", text: "cut", finishReason: "length" },
    ]);
    const output = await agentWith(model).stream("go");
    await output.consumeStream();
    expect(await output.text).toBe("cut");
    expect(await output.finishReason).toBe("length");
  });

  it("maps a refusal to content-filter", async () => {
    const model = scriptedTurns([
      { kind: "text", text: "no", finishReason: "content-filter" },
    ]);
    const output = await agentWith(model).stream("go");
    await output.consumeStream();
    expect(await output.finishReason).toBe("content-filter");
  });

  it("surfaces a thrown error on the output, not as a rejection", async () => {
    const error = new APICallError({
      message: "Overloaded",
      url: "https://example.invalid/v1/messages",
      requestBodyValues: {},
      statusCode: 529,
      isRetryable: true,
    });
    const model = scriptedTurns([{ kind: "error", error }]);
    const output = await agentWith(model).stream("go");
    await output.consumeStream();
    expect(APICallError.isInstance(output.error)).toBe(true);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("returns a plain text turn once the script is exhausted", async () => {
    const model = scriptedTurns([]);
    const output = await agentWith(model).stream("go");
    await output.consumeStream();
    expect(await output.text).toBe("done");
  });
});

describe("demo mock models", () => {
  it("ships a spec that parses and a game that passes E1", () => {
    const spec = GameSpec.parse(MOCK_SPEC);
    const verdict = scoreGame(MOCK_GAME_HTML, { spec }).verdict;
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("builds fresh stateless models for each call", () => {
    const first = demoMockModels();
    const second = demoMockModels();
    expect(first.builder).not.toBe(second.builder);
  });
});
