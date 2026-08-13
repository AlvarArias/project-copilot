/**
 * `LLMProvider` is the port between the agent domain (this directory) and
 * whatever model backs it. PLAN.md decision D5 picks OpenAI as the sole
 * implementation for the MVP (`OpenAIProvider`, written in the
 * infrastructure layer against this interface) but explicitly calls out
 * risk R2 — a single-vendor dependency for both the agent and embeddings.
 * The mitigation is architectural: `agent.ts`, `tools.ts`, and `prompt.ts`
 * only ever import types from this file, never the `openai` package or any
 * of its SDK types. Swapping providers (e.g. a future `AnthropicProvider`)
 * means writing a new adapter against this interface, not touching the
 * domain.
 */

/** A tool the model may call, described as JSON Schema (OpenAI/most providers' native shape). */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

/** A single invocation the model asked for during a turn. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as the model emitted it; the domain parses and validates it. */
  arguments: string;
}

/**
 * Provider-agnostic chat message. Shaped after the common subset of
 * OpenAI/Anthropic/etc. chat APIs: a `tool` message reports one call's
 * result back, keyed by `toolCallId` so the model can match it to the
 * `toolCalls` it requested on a prior `assistant` turn.
 */
export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type LLMFinishReason = "stop" | "tool_calls" | "length" | "other";

/** Events a provider emits while streaming a single completion. */
export type LLMStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "finish"; reason: LLMFinishReason };

export interface LLMCompletionRequest {
  messages: LLMMessage[];
  tools: ToolDefinition[];
}

/** Port the agent domain depends on instead of a concrete LLM SDK. */
export interface LLMProvider {
  /** Concrete model id, exposed for logging/auditing. */
  readonly model: string;

  /**
   * Streams one completion for `request`. Implementations should emit
   * `text-delta` events as prose arrives, `tool-call` events as each tool
   * invocation completes parsing, and exactly one terminal `finish` event.
   */
  streamCompletion(request: LLMCompletionRequest, signal?: AbortSignal): AsyncIterable<LLMStreamEvent>;
}
