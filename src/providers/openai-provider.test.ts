import { afterEach, describe, expect, it } from "vitest";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";

import type { LLMCompletionRequest, LLMStreamEvent } from "@/domain/agent/llm-provider";
import { collect } from "@/domain/agent/test-support/collect";
import { DEFAULT_MODEL, OpenAIProvider, type ChatCompletionsClient } from "@/providers/openai-provider";

function makeChunk(
  delta: ChatCompletionChunk.Choice["delta"],
  finishReason: ChatCompletionChunk.Choice["finish_reason"] = null,
): ChatCompletionChunk {
  return {
    id: "chunk_1",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function fakeClient(chunks: ChatCompletionChunk[]): {
  client: ChatCompletionsClient;
  calls: ChatCompletionCreateParamsStreaming[];
} {
  const calls: ChatCompletionCreateParamsStreaming[] = [];
  const client: ChatCompletionsClient = {
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          return (async function* (): AsyncGenerator<ChatCompletionChunk> {
            for (const c of chunks) yield c;
          })();
        },
      },
    },
  };
  return { client, calls };
}

const BASE_REQUEST: LLMCompletionRequest = {
  messages: [{ role: "user", content: "hola" }],
  tools: [],
};

describe("OpenAIProvider — domain -> OpenAI translation", () => {
  it("sends the configured model id", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "custom-model" });

    await collect(provider.streamCompletion(BASE_REQUEST));

    expect(calls[0].model).toBe("custom-model");
  });

  it("maps an assistant message with toolCalls to OpenAI's tool_calls shape", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "m" });

    await collect(
      provider.streamCompletion({
        messages: [
          {
            role: "assistant",
            content: null,
            toolCalls: [{ id: "call_1", name: "create_task", arguments: '{"name":"A"}' }],
          },
        ],
        tools: [],
      }),
    );

    expect(calls[0].messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "create_task", arguments: '{"name":"A"}' } }],
      },
    ]);
  });

  it("maps a { role: 'tool' } message's toolCallId to tool_call_id", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "m" });

    await collect(
      provider.streamCompletion({
        messages: [{ role: "tool", toolCallId: "call_1", content: '{"ok":true}' }],
        tools: [],
      }),
    );

    expect(calls[0].messages).toEqual([{ role: "tool", tool_call_id: "call_1", content: '{"ok":true}' }]);
  });

  it("maps system and user messages with content passed through", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "m" });

    await collect(
      provider.streamCompletion({
        messages: [
          { role: "system", content: "eres un agente" },
          { role: "user", content: "hola" },
        ],
        tools: [],
      }),
    );

    expect(calls[0].messages).toEqual([
      { role: "system", content: "eres un agente" },
      { role: "user", content: "hola" },
    ]);
  });

  it("maps a ToolDefinition to OpenAI's function tool shape", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "m" });

    await collect(
      provider.streamCompletion({
        messages: BASE_REQUEST.messages,
        tools: [{ name: "create_task", description: "Crea una tarea.", parameters: { type: "object", properties: {} } }],
      }),
    );

    expect(calls[0].tools).toEqual([
      { type: "function", function: { name: "create_task", description: "Crea una tarea.", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it("omits the tools param entirely when there are no tools", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "m" });

    await collect(provider.streamCompletion(BASE_REQUEST));

    expect(calls[0].tools).toBeUndefined();
  });

  // Regression guard: the live API returns a hard 400 ("Function tools with
  // reasoning_effort are not supported ... set reasoning_effort to 'none'")
  // if tools are sent without this. Every agent turn sends tools, so dropping
  // it breaks the whole feature — but only against the real endpoint.
  it("sends reasoning_effort: 'none' whenever tools are present", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "m" });

    await collect(
      provider.streamCompletion({
        messages: BASE_REQUEST.messages,
        tools: [{ name: "list_tasks", description: "Lista tareas.", parameters: { type: "object", properties: {} } }],
      }),
    );

    expect(calls[0].reasoning_effort).toBe("none");
  });

  it("leaves reasoning_effort unset when no tools are sent, keeping the model's default", async () => {
    const { client, calls } = fakeClient([makeChunk({}, "stop")]);
    const provider = new OpenAIProvider({ client, model: "m" });

    await collect(provider.streamCompletion(BASE_REQUEST));

    expect(calls[0].reasoning_effort).toBeUndefined();
  });
});

describe("OpenAIProvider — OpenAI -> domain translation", () => {
  it("turns content deltas into text-delta events", async () => {
    const { client } = fakeClient([
      makeChunk({ content: "Hola" }),
      makeChunk({ content: " mundo" }),
      makeChunk({}, "stop"),
    ]);
    const provider = new OpenAIProvider({ client, model: "m" });

    const events = await collect(provider.streamCompletion(BASE_REQUEST));

    expect(events).toEqual([
      { type: "text-delta", text: "Hola" },
      { type: "text-delta", text: " mundo" },
      { type: "finish", reason: "stop" },
    ]);
  });

  it("reassembles tool-call arguments fragmented across many deltas into one tool-call event", async () => {
    const { client } = fakeClient([
      makeChunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "create_task", arguments: "" } }] }),
      makeChunk({ tool_calls: [{ index: 0, function: { arguments: '{"na' } }] }),
      makeChunk({ tool_calls: [{ index: 0, function: { arguments: 'me":"A"}' } }] }),
      makeChunk({}, "tool_calls"),
    ]);
    const provider = new OpenAIProvider({ client, model: "m" });

    const events = await collect(provider.streamCompletion(BASE_REQUEST));

    const toolCallEvents = events.filter((event): event is Extract<LLMStreamEvent, { type: "tool-call" }> => event.type === "tool-call");
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0].call).toEqual({ id: "call_1", name: "create_task", arguments: '{"name":"A"}' });
  });

  it("reassembles two concurrent tool calls at different indices into two distinct tool-call events, in index order", async () => {
    const { client } = fakeClient([
      makeChunk({
        tool_calls: [
          { index: 0, id: "call_a", type: "function", function: { name: "create_task", arguments: '{"name":"A' } },
        ],
      }),
      makeChunk({
        tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "delete_task", arguments: '{"task_id":"x' } }],
      }),
      makeChunk({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }),
      makeChunk({ tool_calls: [{ index: 1, function: { arguments: '"}' } }] }),
      makeChunk({}, "tool_calls"),
    ]);
    const provider = new OpenAIProvider({ client, model: "m" });

    const events = await collect(provider.streamCompletion(BASE_REQUEST));
    const toolCallEvents = events.filter((event): event is Extract<LLMStreamEvent, { type: "tool-call" }> => event.type === "tool-call");

    expect(toolCallEvents).toHaveLength(2);
    expect(toolCallEvents[0].call).toEqual({ id: "call_a", name: "create_task", arguments: '{"name":"A"}' });
    expect(toolCallEvents[1].call).toEqual({ id: "call_b", name: "delete_task", arguments: '{"task_id":"x"}' });
  });

  it.each([
    ["stop", "stop"],
    ["tool_calls", "tool_calls"],
    ["length", "length"],
    ["content_filter", "other"],
  ] as const)("maps finish_reason %s to %s", async (openaiReason, expected) => {
    const { client } = fakeClient([makeChunk({}, openaiReason)]);
    const provider = new OpenAIProvider({ client, model: "m" });

    const events = await collect(provider.streamCompletion(BASE_REQUEST));

    expect(events).toEqual([{ type: "finish", reason: expected }]);
  });

  it("emits exactly one terminal finish event even across many chunks", async () => {
    const { client } = fakeClient([
      makeChunk({ content: "a" }),
      makeChunk({ content: "b" }),
      makeChunk({ content: "c" }, "stop"),
    ]);
    const provider = new OpenAIProvider({ client, model: "m" });

    const events = await collect(provider.streamCompletion(BASE_REQUEST));

    const finishEvents = events.filter((event) => event.type === "finish");
    expect(finishEvents).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
  });
});

describe("OpenAIProvider — model configuration", () => {
  const originalEnvModel = process.env.OPENAI_MODEL;

  afterEach(() => {
    if (originalEnvModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalEnvModel;
  });

  it("defaults to gpt-5.6-terra when no model or env var is set", () => {
    delete process.env.OPENAI_MODEL;
    const { client } = fakeClient([]);

    const provider = new OpenAIProvider({ client });

    expect(provider.model).toBe(DEFAULT_MODEL);
    expect(provider.model).toBe("gpt-5.6-terra");
  });

  it("prefers the explicit model option over OPENAI_MODEL and the default", () => {
    process.env.OPENAI_MODEL = "env-model";
    const { client } = fakeClient([]);

    const provider = new OpenAIProvider({ client, model: "explicit-model" });

    expect(provider.model).toBe("explicit-model");
  });

  it("falls back to OPENAI_MODEL when no explicit model option is given", () => {
    process.env.OPENAI_MODEL = "env-model";
    const { client } = fakeClient([]);

    const provider = new OpenAIProvider({ client });

    expect(provider.model).toBe("env-model");
  });
});

describe("OpenAIProvider — construction without an injected client", () => {
  it("throws immediately (no network call) when no client, apiKey, or OPENAI_API_KEY is available", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new OpenAIProvider()).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });
});
