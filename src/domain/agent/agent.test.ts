import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/domain/agent/agent";
import { runAgent } from "@/domain/agent/agent";
import type { LLMMessage, LLMProvider, LLMStreamEvent } from "@/domain/agent/llm-provider";
import { collect } from "@/domain/agent/test-support/collect";
import { FakeLLMProvider, type ScriptedTurn } from "@/domain/agent/test-support/fake-llm-provider";
import { createTaskTools } from "@/domain/agent/tools";
import { createInMemoryRepositories } from "@/repositories/test-support/in-memory-repositories";
import type { Message } from "@/domain/types";

const PROJECT_ID = "30303030-3030-4303-8303-303030303030";
const PROJECT_NAME = "Lanzamiento Q3";
const NOW = new Date("2026-08-20T12:00:00Z");

function toolStart(events: AgentEvent[]): AgentEvent[] {
  return events.filter((event) => event.type === "tool-start");
}

describe("runAgent — F3 milestone: creates a task and confirms in streaming", () => {
  it('"Crea una tarea Diseño del 1 al 5 de sept" persists the task and streams a confirmation', async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    const createArgs = { name: "Diseño", start_date: "2026-09-01", end_date: "2026-09-05" };
    const turn1: ScriptedTurn = [
      { type: "tool-call", call: { id: "call_1", name: "create_task", arguments: JSON.stringify(createArgs) } },
      { type: "finish", reason: "tool_calls" },
    ];
    const confirmationChunks = ["Listo, ", "creé la tarea ", '"Diseño" ', "del 1 al 5 de septiembre."];
    const turn2: ScriptedTurn = [
      ...confirmationChunks.map((text): LLMStreamEvent => ({ type: "text-delta", text })),
      { type: "finish", reason: "stop" },
    ];

    const provider = new FakeLLMProvider([turn1, turn2]);

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "Crea una tarea Diseño del 1 al 5 de sept",
        now: NOW,
      }),
    );

    // --- the task is genuinely persisted ---
    const stored = await repos.tasks.listByProject(PROJECT_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      projectId: PROJECT_ID,
      name: "Diseño",
      startDate: "2026-09-01",
      endDate: "2026-09-05",
    });

    // --- event sequence and order: tool-start -> tool-result(ok) -> text* -> done ---
    expect(events[0]).toEqual({ type: "tool-start", name: "create_task", args: createArgs });
    expect(events[1]).toMatchObject({ type: "tool-result", name: "create_task", ok: true });

    const textEvents = events.slice(2, -1);
    expect(textEvents.every((event) => event.type === "text")).toBe(true);
    // --- streaming is real: multiple discrete text events, not one lump ---
    expect(textEvents.length).toBe(confirmationChunks.length);
    expect(textEvents.map((event) => (event as { text: string }).text)).toEqual(confirmationChunks);

    const last = events.at(-1);
    expect(last?.type).toBe("done");
    if (last?.type !== "done") throw new Error("expected a terminal done event");
    expect(last.text).toBe(confirmationChunks.join(""));

    // --- done.toolCalls carries the audit trail persisted to messages.tool_calls ---
    expect(last.toolCalls).toEqual([
      { name: "create_task", args: createArgs, ok: true, summary: expect.stringContaining("Diseño") },
    ]);

    // --- the second request closes the loop: it carries the tool result keyed by the original toolCallId ---
    expect(provider.requests).toHaveLength(2);
    const secondRequestMessages = provider.requests[1].messages;
    const toolMessage = secondRequestMessages.find(
      (message): message is Extract<LLMMessage, { role: "tool" }> => message.role === "tool",
    );
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.toolCallId).toBe("call_1");
    const toolResultPayload = JSON.parse(toolMessage?.content ?? "{}") as { ok: boolean; data?: { name: string } };
    expect(toolResultPayload.ok).toBe(true);
    expect(toolResultPayload.data?.name).toBe("Diseño");
  });
});

describe("runAgent — tool-calling loop behavior", () => {
  it("executes multiple tool calls requested in a single turn, in order", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    const turn1: ScriptedTurn = [
      { type: "tool-call", call: { id: "call_a", name: "create_task", arguments: JSON.stringify({ name: "A" }) } },
      { type: "tool-call", call: { id: "call_b", name: "create_task", arguments: JSON.stringify({ name: "B" }) } },
      { type: "finish", reason: "tool_calls" },
    ];
    const turn2: ScriptedTurn = [{ type: "finish", reason: "stop" }];
    const provider = new FakeLLMProvider([turn1, turn2]);

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "Crea A y B",
        now: NOW,
      }),
    );

    const starts = toolStart(events);
    expect(starts).toHaveLength(2);
    expect(starts.map((e) => (e as { args: unknown }).args)).toEqual([{ name: "A" }, { name: "B" }]);

    const stored = await repos.tasks.listByProject(PROJECT_ID);
    expect(stored.map((t) => t.name)).toEqual(["A", "B"]);
  });

  it("feeds an unknown tool name back to the model as an error result instead of crashing", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    const turn1: ScriptedTurn = [
      { type: "tool-call", call: { id: "call_x", name: "not_a_real_tool", arguments: "{}" } },
      { type: "finish", reason: "tool_calls" },
    ];
    const turn2: ScriptedTurn = [{ type: "finish", reason: "stop" }];
    const provider = new FakeLLMProvider([turn1, turn2]);

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "Haz algo raro",
        now: NOW,
      }),
    );

    const toolResult = events.find((event) => event.type === "tool-result");
    expect(toolResult).toMatchObject({ ok: false, name: "not_a_real_tool" });

    const secondRequestMessages = provider.requests[1].messages;
    const toolMessage = secondRequestMessages.find(
      (message): message is Extract<LLMMessage, { role: "tool" }> => message.role === "tool",
    );
    expect(toolMessage?.toolCallId).toBe("call_x");
    const payload = JSON.parse(toolMessage?.content ?? "{}") as { ok: boolean };
    expect(payload.ok).toBe(false);

    const done = events.at(-1);
    expect(done?.type).toBe("done");
  });

  it("terminates with an error event once maxIterations is reached, instead of looping forever", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    const turn1: ScriptedTurn = [
      { type: "tool-call", call: { id: "call_1", name: "create_task", arguments: JSON.stringify({ name: "A" }) } },
      { type: "finish", reason: "tool_calls" },
    ];
    const provider = new FakeLLMProvider([turn1]);

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "Crea A",
        now: NOW,
        maxIterations: 1,
      }),
    );

    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("emits an error event and stops when the provider throws mid-stream", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    async function* throwingStream(): AsyncGenerator<LLMStreamEvent> {
      yield { type: "text-delta", text: "Hola" };
      throw new Error("network blew up");
    }
    const provider: LLMProvider = {
      model: "throwing-fake",
      streamCompletion: () => throwingStream(),
    };

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "Hola",
        now: NOW,
      }),
    );

    expect(events[0]).toEqual({ type: "text", text: "Hola" });
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type !== "error") throw new Error("expected a terminal error event");
    expect(last.message).toContain("network blew up");
  });

  it("replays prior history into the first request, with the system prompt first and the user message last", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    const history: Message[] = [
      { id: "m1", projectId: PROJECT_ID, role: "user", content: "Hola", toolCalls: null, createdAt: NOW.toISOString() },
      {
        id: "m2",
        projectId: PROJECT_ID,
        role: "assistant",
        content: "Hola, ¿en qué te ayudo?",
        toolCalls: null,
        createdAt: NOW.toISOString(),
      },
    ];
    const turn1: ScriptedTurn = [{ type: "finish", reason: "stop" }];
    const provider = new FakeLLMProvider([turn1]);

    await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history,
        userMessage: "¿Cómo va el proyecto?",
        now: NOW,
      }),
    );

    const messages = provider.requests[0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "Hola" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Hola, ¿en qué te ayudo?" });
    expect(messages.at(-1)).toEqual({ role: "user", content: "¿Cómo va el proyecto?" });
  });

  it("uses the injectable `now` to make the system prompt's date deterministic", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();
    const turn1: ScriptedTurn = [{ type: "finish", reason: "stop" }];
    const provider = new FakeLLMProvider([turn1]);

    await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "¿Qué día es hoy?",
        now: new Date("2026-01-15T23:59:00Z"),
      }),
    );

    const systemMessage = provider.requests[0].messages[0];
    expect(systemMessage.role).toBe("system");
    if (systemMessage.role !== "system") throw new Error("expected a system message");
    expect(systemMessage.content).toContain("2026-01-15");
  });
});

describe("runAgent — prose from tool-calling iterations survives into done.text", () => {
  it("keeps narration streamed before a tool call, not just the final iteration's text", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    const narration = "Voy a revisar las tareas primero.";
    const confirmation = "No hay tareas todavía.";
    const turn1: ScriptedTurn = [
      { type: "text-delta", text: narration },
      { type: "tool-call", call: { id: "call_1", name: "list_tasks", arguments: "{}" } },
      { type: "finish", reason: "tool_calls" },
    ];
    const turn2: ScriptedTurn = [
      { type: "text-delta", text: confirmation },
      { type: "finish", reason: "stop" },
    ];
    const provider = new FakeLLMProvider([turn1, turn2]);

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "¿Qué tareas hay?",
        now: NOW,
      }),
    );

    // Both segments were streamed live...
    const streamed = events.filter((event) => event.type === "text").map((event) => (event as { text: string }).text);
    expect(streamed).toEqual([narration, confirmation]);

    // ...and both survive into `done.text`, which is what `/api/chat`
    // persists to `messages.content` and replays as history next turn.
    const last = events.at(-1);
    if (last?.type !== "done") throw new Error("expected a terminal done event");
    expect(last.text).toBe(`${narration}\n\n${confirmation}`);
  });

  it("does not introduce blank separators when an iteration streams no prose", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();

    const turn1: ScriptedTurn = [
      { type: "tool-call", call: { id: "call_1", name: "list_tasks", arguments: "{}" } },
      { type: "finish", reason: "tool_calls" },
    ];
    const turn2: ScriptedTurn = [
      { type: "text-delta", text: "Listo." },
      { type: "finish", reason: "stop" },
    ];
    const provider = new FakeLLMProvider([turn1, turn2]);

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "¿Qué tareas hay?",
        now: NOW,
      }),
    );

    const last = events.at(-1);
    if (last?.type !== "done") throw new Error("expected a terminal done event");
    expect(last.text).toBe("Listo.");
  });
});

describe("runAgent — cancellation", () => {
  it("forwards the AbortSignal to the provider on every iteration", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();
    const controller = new AbortController();

    const turn1: ScriptedTurn = [
      { type: "tool-call", call: { id: "call_1", name: "list_tasks", arguments: "{}" } },
      { type: "finish", reason: "tool_calls" },
    ];
    const turn2: ScriptedTurn = [{ type: "finish", reason: "stop" }];
    const provider = new FakeLLMProvider([turn1, turn2]);

    await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "¿Qué tareas hay?",
        now: NOW,
        signal: controller.signal,
      }),
    );

    expect(provider.signals).toHaveLength(2);
    expect(provider.signals.every((signal) => signal === controller.signal)).toBe(true);
  });

  it("surfaces an aborted turn as an error event rather than a silent done", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();
    const controller = new AbortController();
    controller.abort();

    const provider = new FakeLLMProvider([[{ type: "finish", reason: "stop" }]]);

    const events = await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "Hola",
        now: NOW,
        signal: controller.signal,
      }),
    );

    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("passes `undefined` through when no signal is supplied", async () => {
    const repos = createInMemoryRepositories();
    const tools = createTaskTools();
    const provider = new FakeLLMProvider([[{ type: "finish", reason: "stop" }]]);

    await collect(
      runAgent({
        provider,
        tools,
        repos,
        projectId: PROJECT_ID,
        projectName: PROJECT_NAME,
        history: [],
        userMessage: "Hola",
        now: NOW,
      }),
    );

    expect(provider.signals).toEqual([undefined]);
  });
});
