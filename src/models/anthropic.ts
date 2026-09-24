import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FetchLike } from "./cassette.ts";

export interface AnthropicSettings {
  readonly apiKey: string;
  readonly fetch?: FetchLike | undefined;
}

/**
 * Builds the Anthropic provider model. The key is always passed explicitly, never read from the
 * environment by the provider, and `fetch` is where the cassette layer sits (§7.2).
 * @param modelId Anthropic model id
 * @param settings API key and optional fetch
 */
export function anthropicModel(
  modelId: string,
  settings: AnthropicSettings,
): LanguageModelV4 {
  const provider = createAnthropic(
    settings.fetch
      ? { apiKey: settings.apiKey, fetch: settings.fetch }
      : { apiKey: settings.apiKey },
  );
  return provider(modelId);
}
