/**
 * The tool-calling loop. Depends only on {@link LLMProvider} (never an SDK)
 * and {@link Repositories}; `/api/chat` (infrastructure) is the only place
 * that persists anything — `runAgent` just streams events and returns.
 */

import type { Repositories } from "@/domain/repositories";
import type { Message } from "@/domain/types";

import type { LLMMessage, LLMProvider, ToolCall } from "./llm-provider";
import { buildSystemPrompt } from "./prompt";
import type { AgentTool, ToolContext, ToolResult } from "./tools";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool-start"; name: string; args: unknown }
  | { type: "tool-result"; name: string; ok: boolean; summary: string }
  | { type: "done"; text: string; toolCalls: ToolCallAudit[] }
  | { type: "error"; message: string };

/** One tool invocation, kept for the UI's "what did the agent do" indicator and for `messages.tool_calls`. */
export interface ToolCallAudit {
  name: string;
  args: unknown;
  ok: boolean;
  summary: string;
}

export interface RunAgentInput {
  provider: LLMProvider;
  tools: AgentTool[];
  repos: Repositories;
  projectId: string;
  projectName: string;
  /** Prior turns from `MessageRepository`, oldest first. */
  history: Message[];
  userMessage: string;
  /** Injectable clock, so "today" in the system prompt is deterministic in tests. Defaults to `new Date()`. */
  now?: Date;
  maxIterations?: number;
  /**
   * Cancels the turn. Forwarded to the provider so a client disconnecting
   * from `/api/chat` actually aborts the in-flight upstream request rather
   * than leaving it running (and billing) unattended.
   */
  signal?: AbortSignal;
}

const DEFAULT_MAX_ITERATIONS = 6;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Replays prior turns as plain user/assistant text. Past tool calls are
 * intentionally NOT reconstructed as `toolCalls`/`tool` message pairs here:
 * `messages.tool_calls` only stores the {@link ToolCallAudit} shape (name,
 * args, ok, summary) for UI/audit purposes, not the provider's raw call id
 * or argument JSON string, so it can't be replayed as a faithful tool-call
 * turn. The persisted assistant `content` already carries the model's final
 * confirmation prose, which is all a later turn needs to keep context.
 */
function historyToMessages(history: Message[]): LLMMessage[] {
  return history.map((message): LLMMessage =>
    message.role === "user"
      ? { role: "user", content: message.content ?? "" }
      : { role: "assistant", content: message.content },
  );
}

/**
 * Runs one user turn through the agent loop: stream a completion, execute
 * any requested tools, feed their results back, and repeat until the model
 * stops calling tools (or `maxIterations` is hit). Yields events as they
 * happen so the caller can forward them over SSE.
 */
export async function* runAgent(input: RunAgentInput): AsyncGenerator<AgentEvent> {
  const {
    provider,
    tools,
    repos,
    projectId,
    projectName,
    history,
    userMessage,
    now = new Date(),
    maxIterations = DEFAULT_MAX_ITERATIONS,
    signal,
  } = input;

  const toolsByName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  const toolContext: ToolContext = { projectId, repos };
  const toolDefinitions = tools.map((tool) => tool.definition);

  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt({ projectName, today: toIsoDate(now) }) },
    ...historyToMessages(history),
    { role: "user", content: userMessage },
  ];

  const auditTrail: ToolCallAudit[] = [];
  // Prose from EVERY iteration, not just the last one: a model often narrates
  // ("Voy a revisar las tareas primero.") in an iteration that also calls a
  // tool. That text is streamed to the client live, so dropping it from
  // `done.text` would silently lose it from `messages.content` — and hence
  // from the history replayed on the next turn.
  const textSegments: string[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let turnText = "";
    const turnToolCalls: ToolCall[] = [];

    try {
      for await (const event of provider.streamCompletion({ messages, tools: toolDefinitions }, signal)) {
        if (event.type === "text-delta") {
          turnText += event.text;
          yield { type: "text", text: event.text };
        } else if (event.type === "tool-call") {
          turnToolCalls.push(event.call);
        }
        // "finish" carries only the stop reason; the loop already decides
        // what to do next from whether tool calls were produced.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "error", message: `Error al comunicarse con el modelo: ${message}` };
      return;
    }

    if (turnText.length > 0) {
      textSegments.push(turnText);
    }

    if (turnToolCalls.length === 0) {
      yield { type: "done", text: textSegments.join("\n\n"), toolCalls: auditTrail };
      return;
    }

    messages.push({
      role: "assistant",
      content: turnText.length > 0 ? turnText : null,
      toolCalls: turnToolCalls,
    });

    for (const call of turnToolCalls) {
      const args = parseToolArguments(call.arguments);
      yield { type: "tool-start", name: call.name, args };

      const tool = toolsByName.get(call.name);
      const result: ToolResult = tool
        ? await tool.execute(args, toolContext)
        : { ok: false, summary: `No existe ninguna herramienta llamada "${call.name}".` };

      yield { type: "tool-result", name: call.name, ok: result.ok, summary: result.summary };
      auditTrail.push({ name: call.name, args, ok: result.ok, summary: result.summary });

      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
    }
  }

  yield {
    type: "error",
    message: `El agente alcanzó el límite de ${maxIterations} iteraciones sin terminar la respuesta.`,
  };
}

/** Tools parse/validate their own args with zod, so a bad JSON string here is just passed through as-is and rejected there. */
function parseToolArguments(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
