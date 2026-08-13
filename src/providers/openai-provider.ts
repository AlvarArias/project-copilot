/**
 * `LLMProvider` implementation backed by OpenAI's Chat Completions API.
 * This is the ONLY file (together with `./index.ts`) allowed to import the
 * `openai` package — see the architectural boundary documented in
 * `@/domain/agent/llm-provider`.
 */

import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import type {
  LLMCompletionRequest,
  LLMFinishReason,
  LLMMessage,
  LLMProvider,
  LLMStreamEvent,
  ToolCall,
  ToolDefinition,
} from "@/domain/agent/llm-provider";

/**
 * Default model for the agent's tool-calling loop, overridable via the
 * `OPENAI_MODEL` env var.
 *
 * `gpt-5.6-terra` is OpenAI's balanced intelligence/cost tier ($2/MTok in,
 * $12/MTok out): it supports `streaming`, `function_calling`,
 * `structured_outputs`, and `prompt_caching`, and — unlike some newer
 * models — is explicitly supported on `v1/chat/completions`, not
 * Responses-only.
 *
 * Chat Completions (rather than the Responses API) was chosen as the
 * transport this class adapts because its streaming + tool-calling delta
 * protocol is the simpler, better-established one to translate behind
 * {@link LLMProvider}; the port makes this choice reversible either way, so
 * it isn't load-bearing.
 *
 * Known cost of that choice, found end-to-end against the live API: this
 * model refuses function tools on `/v1/chat/completions` unless
 * `reasoning_effort` is `"none"` (see `streamCompletion`). So the agent
 * currently runs with reasoning disabled, which OpenAI documents as suited
 * to work that "does not benefit from any reasoning or multi-chained tool
 * calls". That is a fair description of F3's single-step task CRUD, but if a
 * later phase needs the model to reason across chained tools (F6's
 * `detect_conflicts` is the likely trigger), the fix is to port this adapter
 * to `/v1/responses` — a change contained entirely within this file.
 */
export const DEFAULT_MODEL = "gpt-5.6-terra";

/**
 * The narrow slice of the OpenAI SDK client `OpenAIProvider` actually calls
 * — declared ourselves rather than depending on the SDK's much larger
 * `OpenAI` class type, so a test double only has to implement this one
 * method to stand in for the real client.
 */
export interface ChatCompletionsClient {
  chat: {
    completions: {
      create(
        params: ChatCompletionCreateParamsStreaming,
        options?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<ChatCompletionChunk>>;
    };
  };
}

export interface OpenAIProviderOptions {
  /** Injectable stand-in for the real SDK client; defaults to `new OpenAI({ apiKey })`. */
  client?: ChatCompletionsClient;
  /** Defaults to `OPENAI_MODEL`, then {@link DEFAULT_MODEL}. */
  model?: string;
  /** Defaults to `OPENAI_API_KEY`. Only read when `client` isn't supplied. */
  apiKey?: string;
}

function toOpenAIToolCall(call: ToolCall): ChatCompletionMessageFunctionToolCall {
  return {
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: call.arguments },
  };
}

function toOpenAIMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCalls && message.toolCalls.length > 0
            ? { tool_calls: message.toolCalls.map(toOpenAIToolCall) }
            : {}),
        };
      case "tool":
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
  });
}

function toOpenAITools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

function toFinishReason(reason: ChatCompletionChunk.Choice["finish_reason"]): LLMFinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "length";
    default:
      return "other";
  }
}

/**
 * Accumulates streamed tool-call argument fragments. OpenAI keys each delta
 * by `index` (position among the calls in this turn), not by `id` — the id
 * and function name typically only arrive on the delta that opens a given
 * index, with `arguments` trickling in afterwards across many deltas.
 */
class ToolCallAccumulator {
  private readonly byIndex = new Map<number, { id: string; name: string; arguments: string }>();

  add(delta: NonNullable<ChatCompletionChunk.Choice["delta"]["tool_calls"]>[number]): void {
    const existing = this.byIndex.get(delta.index);
    if (!existing) {
      this.byIndex.set(delta.index, {
        id: delta.id ?? "",
        name: delta.function?.name ?? "",
        arguments: delta.function?.arguments ?? "",
      });
      return;
    }
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name = delta.function.name;
    if (delta.function?.arguments) existing.arguments += delta.function.arguments;
  }

  toToolCalls(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call);
  }
}

function createDefaultClient(apiKey: string | undefined): ChatCompletionsClient {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Configure it in .env, or pass an apiKey/client explicitly to OpenAIProvider.",
    );
  }
  return new OpenAI({ apiKey: key });
}

/** `LLMProvider` port implemented against OpenAI's Chat Completions API. */
export class OpenAIProvider implements LLMProvider {
  readonly model: string;
  private readonly client: ChatCompletionsClient;

  constructor(options: OpenAIProviderOptions = {}) {
    this.model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    // Lazy: only touches `OPENAI_API_KEY`/constructs a real SDK client when
    // no test double was injected, so importing this module never throws.
    this.client = options.client ?? createDefaultClient(options.apiKey);
  }

  async *streamCompletion(request: LLMCompletionRequest, signal?: AbortSignal): AsyncIterable<LLMStreamEvent> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        stream: true,
        messages: toOpenAIMessages(request.messages),
        // `reasoning_effort: "none"` is REQUIRED, not an optimization: on
        // `/v1/chat/completions` this model rejects function tools outright
        // with a 400 ("Function tools with reasoning_effort are not supported
        // ... set reasoning_effort to 'none'") unless reasoning is disabled.
        // `"none"` is the only permitted value here — the alternative is
        // moving this adapter to `/v1/responses`, which is what OpenAI
        // recommends for reasoning + multi-step tool calls. See the note on
        // DEFAULT_MODEL.
        ...(request.tools.length > 0
          ? { tools: toOpenAITools(request.tools), reasoning_effort: "none" as const }
          : {}),
      },
      { signal },
    );

    const toolCalls = new ToolCallAccumulator();
    let finishReason: LLMFinishReason = "other";

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (choice.delta.content) {
        yield { type: "text-delta", text: choice.delta.content };
      }
      for (const toolCallDelta of choice.delta.tool_calls ?? []) {
        toolCalls.add(toolCallDelta);
      }
      if (choice.finish_reason) {
        finishReason = toFinishReason(choice.finish_reason);
      }
    }

    for (const call of toolCalls.toToolCalls()) {
      yield { type: "tool-call", call };
    }
    yield { type: "finish", reason: finishReason };
  }
}
