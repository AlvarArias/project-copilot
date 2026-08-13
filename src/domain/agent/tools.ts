/**
 * The F3 task tools the agent can call: `create_task`, `update_task`,
 * `delete_task`, `list_tasks`. `detect_conflicts` (F6) and `search_documents`
 * (F5) are deliberately out of scope here — they land in later phases.
 *
 * Tools only ever talk to `Repositories`; they never touch HTTP or the LLM,
 * which is what makes them testable with `createInMemoryRepositories()`
 * instead of a real database or a real model.
 */

import { z } from "zod";

import { normalizeDate } from "@/lib/dates";
import type { Repositories } from "@/domain/repositories";
import { TASK_STATUSES, type Task, type TaskPatch } from "@/domain/types";

import type { ToolDefinition } from "./llm-provider";

export interface ToolContext {
  projectId: string;
  repos: Repositories;
}

/**
 * `ok: false` covers every user-recoverable failure (bad args, ambiguous or
 * missing task, unparseable date) — these are fed back to the model as a
 * `tool` message so it can retry or ask the user, never thrown. Only
 * genuinely unexpected errors (e.g. the database is down) should propagate
 * as exceptions out of `execute`.
 */
export interface ToolResult {
  ok: boolean;
  /** User-facing Spanish text surfaced live in the chat UI (PLAN.md A3). */
  summary: string;
  data?: unknown;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(rawArgs: unknown, context: ToolContext): Promise<ToolResult>;
}

/** Strips zod's `$schema` key so `parameters` is a plain JSON Schema object. */
function toolParameters(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;
  return jsonSchema;
}

function formatRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} → ${end}`;
  if (start) return `desde ${start}`;
  if (end) return `hasta ${end}`;
  return "sin fechas definidas";
}

function parseArgs<T>(
  schema: z.ZodType<T>,
  rawArgs: unknown,
  toolName: string,
): { data: T } | { result: ToolResult } {
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      result: { ok: false, summary: `No pude interpretar los argumentos de ${toolName}: ${issues}.` },
    };
  }
  return { data: parsed.data };
}

/**
 * Resolves `task_id`/`task_name` into a {@link Task} scoped to
 * `context.projectId`. Name matching is case-insensitive: exact match first,
 * then unique substring match. Zero or multiple matches return an `error`
 * string instructing the model to call `list_tasks` and retry with
 * `task_id`, per the F3 brief — this is a user-recoverable outcome, not an
 * exception.
 */
async function resolveTaskRef(
  args: { task_id?: string; task_name?: string },
  context: ToolContext,
): Promise<{ task: Task } | { error: string }> {
  if (args.task_id) {
    const task = await context.repos.tasks.findById(args.task_id);
    if (!task || task.projectId !== context.projectId) {
      return {
        error: `No encontré ninguna tarea con id "${args.task_id}" en este proyecto. Llama a list_tasks para ver los ids disponibles.`,
      };
    }
    return { task };
  }

  const needle = (args.task_name ?? "").trim().toLowerCase();
  const tasks = await context.repos.tasks.listByProject(context.projectId);

  const exact = tasks.filter((task) => task.name.toLowerCase() === needle);
  if (exact.length === 1) return { task: exact[0] };
  if (exact.length > 1) {
    return {
      error: `Hay ${exact.length} tareas llamadas "${args.task_name}". Llama a list_tasks y usa task_id para indicar cuál.`,
    };
  }

  const partial = tasks.filter((task) => task.name.toLowerCase().includes(needle));
  if (partial.length === 1) return { task: partial[0] };
  if (partial.length === 0) {
    return {
      error: `No encontré ninguna tarea que coincida con "${args.task_name}". Llama a list_tasks para ver los nombres disponibles.`,
    };
  }
  return {
    error: `Hay ${partial.length} tareas que coinciden con "${args.task_name}" (${partial
      .map((task) => task.name)
      .join(", ")}). Llama a list_tasks y usa task_id para indicar cuál.`,
  };
}

const createTaskArgsSchema = z.object({
  name: z.string().min(1).describe("Nombre de la tarea/deliverable, tal como debe aparecer en el Gantt."),
  start_date: z
    .string()
    .optional()
    .describe("Fecha de inicio en cualquier formato reconocible (se normaliza a YYYY-MM-DD)."),
  end_date: z
    .string()
    .optional()
    .describe("Fecha de fin en cualquier formato reconocible (se normaliza a YYYY-MM-DD)."),
  progress: z.number().min(0).max(100).optional().describe("Porcentaje de avance, de 0 a 100."),
  status: z.enum(TASK_STATUSES).optional().describe(`Estado de la tarea. Uno de: ${TASK_STATUSES.join(", ")}.`),
});

const updateTaskArgsSchema = z
  .object({
    task_id: z
      .string()
      .uuid()
      .optional()
      .describe("Id de la tarea a actualizar; prefiérelo si ya lo conoces (p. ej. por un list_tasks previo)."),
    task_name: z
      .string()
      .min(1)
      .optional()
      .describe("Nombre (o parte de él) de la tarea a actualizar, si no conoces el id. Debe identificar una única tarea."),
    name: z.string().min(1).optional().describe("Nuevo nombre de la tarea."),
    start_date: z
      .string()
      .optional()
      .describe("Nueva fecha de inicio en cualquier formato reconocible (se normaliza a YYYY-MM-DD)."),
    end_date: z
      .string()
      .optional()
      .describe("Nueva fecha de fin en cualquier formato reconocible (se normaliza a YYYY-MM-DD)."),
    progress: z.number().min(0).max(100).optional().describe("Nuevo porcentaje de avance, de 0 a 100."),
    status: z.enum(TASK_STATUSES).optional().describe(`Nuevo estado. Uno de: ${TASK_STATUSES.join(", ")}.`),
  })
  .describe("Debes indicar task_id o task_name (al menos uno), y al menos un campo a modificar.");

const deleteTaskArgsSchema = z
  .object({
    task_id: z.string().uuid().optional().describe("Id de la tarea a eliminar."),
    task_name: z
      .string()
      .min(1)
      .optional()
      .describe("Nombre (o parte de él) de la tarea a eliminar, si no conoces el id. Debe identificar una única tarea."),
  })
  .describe("Debes indicar task_id o task_name.");

const listTasksArgsSchema = z.object({}).describe("No requiere argumentos.");

async function executeCreateTask(rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(createTaskArgsSchema, rawArgs, "create_task");
  if ("result" in parsed) return parsed.result;
  const args = parsed.data;

  const startDate = normalizeDate(args.start_date ?? null);
  if (args.start_date && !startDate) {
    return { ok: false, summary: `No pude interpretar la fecha de inicio "${args.start_date}". Usa un formato como YYYY-MM-DD.` };
  }
  const endDate = normalizeDate(args.end_date ?? null);
  if (args.end_date && !endDate) {
    return { ok: false, summary: `No pude interpretar la fecha de fin "${args.end_date}". Usa un formato como YYYY-MM-DD.` };
  }

  const task = await context.repos.tasks.create({
    projectId: context.projectId,
    name: args.name,
    startDate,
    endDate,
    progress: args.progress,
    status: args.status,
  });

  return {
    ok: true,
    summary: `Creé la tarea "${task.name}" (${formatRange(task.startDate, task.endDate)}).`,
    data: task,
  };
}

async function executeUpdateTask(rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(updateTaskArgsSchema, rawArgs, "update_task");
  if ("result" in parsed) return parsed.result;
  const args = parsed.data;

  if (!args.task_id && !args.task_name) {
    return { ok: false, summary: "Para actualizar una tarea necesito task_id o task_name. Llama a list_tasks si no conoces el id." };
  }

  const resolved = await resolveTaskRef(args, context);
  if ("error" in resolved) return { ok: false, summary: resolved.error };
  const { task } = resolved;

  const patch: TaskPatch = {};
  if (args.name !== undefined) patch.name = args.name;
  if (args.progress !== undefined) patch.progress = args.progress;
  if (args.status !== undefined) patch.status = args.status;

  if (args.start_date !== undefined) {
    const normalized = normalizeDate(args.start_date);
    if (!normalized) {
      return { ok: false, summary: `No pude interpretar la fecha de inicio "${args.start_date}". Usa un formato como YYYY-MM-DD.` };
    }
    patch.startDate = normalized;
  }
  if (args.end_date !== undefined) {
    const normalized = normalizeDate(args.end_date);
    if (!normalized) {
      return { ok: false, summary: `No pude interpretar la fecha de fin "${args.end_date}". Usa un formato como YYYY-MM-DD.` };
    }
    patch.endDate = normalized;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, summary: `No indicaste ningún cambio para la tarea "${task.name}".` };
  }

  const updated = await context.repos.tasks.update(task.id, patch);
  if (!updated) {
    return { ok: false, summary: `La tarea "${task.name}" ya no existe.` };
  }

  return {
    ok: true,
    summary: `Actualicé la tarea "${updated.name}" (${formatRange(updated.startDate, updated.endDate)}).`,
    data: updated,
  };
}

async function executeDeleteTask(rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(deleteTaskArgsSchema, rawArgs, "delete_task");
  if ("result" in parsed) return parsed.result;
  const args = parsed.data;

  if (!args.task_id && !args.task_name) {
    return { ok: false, summary: "Para eliminar una tarea necesito task_id o task_name. Llama a list_tasks si no conoces el id." };
  }

  const resolved = await resolveTaskRef(args, context);
  if ("error" in resolved) return { ok: false, summary: resolved.error };
  const { task } = resolved;

  const deleted = await context.repos.tasks.delete(task.id);
  if (!deleted) {
    return { ok: false, summary: `La tarea "${task.name}" ya no existe.` };
  }

  return { ok: true, summary: `Eliminé la tarea "${task.name}".` };
}

async function executeListTasks(rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
  const parsed = parseArgs(listTasksArgsSchema, rawArgs, "list_tasks");
  if ("result" in parsed) return parsed.result;

  const tasks = await context.repos.tasks.listByProject(context.projectId);
  const summary =
    tasks.length === 0
      ? "El proyecto todavía no tiene tareas."
      : `El proyecto tiene ${tasks.length} tarea(s): ${tasks
          .map((task) => `"${task.name}" (${formatRange(task.startDate, task.endDate)})`)
          .join(", ")}.`;

  return {
    ok: true,
    summary,
    data: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      startDate: task.startDate,
      endDate: task.endDate,
      progress: task.progress,
      status: task.status,
    })),
  };
}

/** Builds the four F3 task tools. */
export function createTaskTools(): AgentTool[] {
  return [
    {
      definition: {
        name: "create_task",
        description:
          "Crea una nueva tarea/deliverable en el proyecto actual. Usa esto cuando el usuario pida agregar algo al cronograma.",
        parameters: toolParameters(createTaskArgsSchema),
      },
      execute: executeCreateTask,
    },
    {
      definition: {
        name: "update_task",
        description:
          "Actualiza una tarea existente (nombre, fechas, progreso o estado). Usa esto para mover, reprogramar o modificar una tarea. " +
          "Si no conoces su id, primero intenta con task_name; si list_tasks ya te dio el id, prefiérelo.",
        parameters: toolParameters(updateTaskArgsSchema),
      },
      execute: executeUpdateTask,
    },
    {
      definition: {
        name: "delete_task",
        description: "Elimina una tarea del proyecto actual. Usa esto cuando el usuario pida quitar o cancelar una tarea.",
        parameters: toolParameters(deleteTaskArgsSchema),
      },
      execute: executeDeleteTask,
    },
    {
      definition: {
        name: "list_tasks",
        description:
          "Lista todas las tareas del proyecto actual con su id, nombre, fechas, progreso y estado. " +
          "Llama a esto antes de update_task/delete_task cuando no conozcas el id exacto de una tarea, o cuando el usuario pregunte por el estado del cronograma.",
        parameters: toolParameters(listTasksArgsSchema),
      },
      execute: executeListTasks,
    },
  ];
}
