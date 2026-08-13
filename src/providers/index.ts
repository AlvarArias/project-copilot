/**
 * Composition root for `LLMProvider`, mirroring how `src/repositories/index.ts`
 * exposes `createRepositories()`. `/api/chat` (and any other consumer)
 * should construct providers through this factory rather than reaching for
 * `OpenAIProvider` directly, so swapping providers later is a one-line change.
 */

import type { LLMProvider } from "@/domain/agent/llm-provider";

import { OpenAIProvider } from "./openai-provider";

export { OpenAIProvider };

/** Builds the `LLMProvider` used by `/api/chat` (PLAN.md decision D5: OpenAI-only for the MVP). */
export function createLLMProvider(): LLMProvider {
  return new OpenAIProvider();
}
