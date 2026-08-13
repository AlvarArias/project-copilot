/**
 * `POST /api/chat` — runs one user turn through the F3 agent (`runAgent`)
 * and streams the result back as Server-Sent Events.
 *
 * ## Wire contract (F4's chat UI depends on this)
 * Each SSE frame is `event: <name>\ndata: <json>\n\n`. `AgentEvent`s map to
 * frames as follows:
 *
 * | `AgentEvent.type` | SSE `event` | `data` shape                                          |
 * |--------------------|-------------|-------------------------------------------------------|
 * | `text`             | `token`     | `{ text: string }`                                     |
 * | `tool-start`        | `tool`      | `{ name: string, status: "running", args: unknown }`   |
 * | `tool-result`       | `tool`      | `{ name: string, status: "ok" \| "error", summary: string }` |
 * | `done`              | `done`      | `{ messageId: string, text: string, toolCalls: ToolCallAudit[] }` |
 * | `error`             | `error`     | `{ message: string }`                                  |
 *
 * `done.messageId` is the id of the assistant `Message` this route persists
 * once the turn finishes — see the `case "done"` branch below.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import type { AgentEvent } from "@/domain/agent/agent";
import { runAgent } from "@/domain/agent/agent";
import { createTaskTools } from "@/domain/agent/tools";
import { DEMO_PROJECT_NAME } from "@/domain/demo-project";
import type { Repositories } from "@/domain/repositories";
import { createLLMProvider } from "@/providers";
import { createRepositories } from "@/repositories";

// `pg` needs a real TCP connection to Postgres, which the Edge runtime
// doesn't support — this route must run on Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  message: z.string().trim().min(1, "message no puede estar vacío."),
  projectId: z.string().uuid().optional(),
});

const encoder = new TextEncoder();

function sseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Persists the assistant turn on `done`; every other event is a pure translation. */
async function forwardEvent(
  event: AgentEvent,
  enqueue: (event: string, data: unknown) => void,
  repos: Repositories,
  projectId: string,
): Promise<void> {
  switch (event.type) {
    case "text":
      enqueue("token", { text: event.text });
      return;
    case "tool-start":
      enqueue("tool", { name: event.name, status: "running", args: event.args });
      return;
    case "tool-result":
      enqueue("tool", { name: event.name, status: event.ok ? "ok" : "error", summary: event.summary });
      return;
    case "done": {
      const saved = await repos.messages.create({
        projectId,
        role: "assistant",
        content: event.text,
        toolCalls: event.toolCalls,
      });
      enqueue("done", { messageId: saved.id, text: event.text, toolCalls: event.toolCalls });
      return;
    }
    case "error":
      enqueue("error", { message: event.message });
      return;
  }
}

export async function POST(request: Request): Promise<Response> {
  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((issue) => issue.message).join("; ") },
      { status: 400 },
    );
  }
  const { message, projectId } = parsed.data;

  const repos = createRepositories();
  const project = projectId
    ? await repos.projects.findById(projectId)
    : await repos.projects.findByName(DEMO_PROJECT_NAME);

  if (!project) {
    return NextResponse.json(
      {
        error: projectId
          ? `Project ${projectId} was not found.`
          : "The demo project hasn't been seeded yet — run `npm run seed`.",
      },
      { status: 404 },
    );
  }

  // Load history BEFORE persisting the current turn, so it isn't duplicated
  // into its own context.
  const history = await repos.messages.listByProject(project.id);
  await repos.messages.create({ projectId: project.id, role: "user", content: message });

  // `createRepositories()` defaults to the shared `pg` pool, which checks
  // out and releases a connection per query — there's no per-request client
  // to leak here, so a client disconnect only needs to stop us from writing
  // to (or re-closing) a torn-down controller.
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(event, data));
        } catch {
          closed = true;
        }
      };

      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      try {
        for await (const event of runAgent({
          provider: createLLMProvider(),
          tools: createTaskTools(),
          repos,
          projectId: project.id,
          projectName: project.name,
          history,
          userMessage: message,
          // Cancels the upstream model request too, not just our SSE writes.
          signal: request.signal,
        })) {
          if (closed) break;
          await forwardEvent(event, enqueue, repos, project.id);
        }
      } catch (error) {
        // `runAgent` deliberately lets unexpected repository errors
        // propagate rather than swallowing them as a tool-level `ok: false`
        // — turn that into a terminal error frame instead of hanging.
        const messageText = error instanceof Error ? error.message : String(error);
        enqueue("error", { message: messageText });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
