import { describe, expect, it } from "vitest";

import { createTaskTools, type AgentTool, type ToolContext } from "@/domain/agent/tools";
import { createInMemoryRepositories } from "@/repositories/test-support/in-memory-repositories";

const PROJECT_ID = "10101010-1010-4101-8101-101010101010";
const OTHER_PROJECT_ID = "20202020-2020-4202-8202-202020202020";

function setup() {
  const repos = createInMemoryRepositories();
  const tools = createTaskTools();
  const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  const context: ToolContext = { projectId: PROJECT_ID, repos };
  return { repos, tools, byName, context };
}

function getTool(byName: Map<string, AgentTool>, name: string): AgentTool {
  const tool = byName.get(name);
  if (!tool) throw new Error(`tool "${name}" not found`);
  return tool;
}

describe("create_task", () => {
  it("creates a task in the current project with the given fields", async () => {
    const { byName, context, repos } = setup();
    const tool = getTool(byName, "create_task");

    const result = await tool.execute(
      { name: "Diseño", start_date: "2026-09-01", end_date: "2026-09-05", progress: 10, status: "in_progress" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Diseño");
    const stored = await repos.tasks.listByProject(PROJECT_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      projectId: PROJECT_ID,
      name: "Diseño",
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      progress: 10,
      status: "in_progress",
    });
  });

  it("normalizes a non-ISO date before persisting it", async () => {
    const { byName, context, repos } = setup();
    const tool = getTool(byName, "create_task");

    const result = await tool.execute({ name: "Diseño", start_date: "9/1/2026" }, context);

    expect(result.ok).toBe(true);
    const [task] = await repos.tasks.listByProject(PROJECT_ID);
    expect(task.startDate).toBe("2026-09-01");
  });

  it("returns ok:false without throwing when name is missing", async () => {
    const { byName, context, repos } = setup();
    const tool = getTool(byName, "create_task");

    const result = await tool.execute({}, context);

    expect(result.ok).toBe(false);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(await repos.tasks.listByProject(PROJECT_ID)).toHaveLength(0);
  });

  it("returns ok:false for an out-of-range progress value", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "create_task");

    const result = await tool.execute({ name: "Diseño", progress: 150 }, context);

    expect(result.ok).toBe(false);
  });

  it("returns ok:false for an invalid status value", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "create_task");

    const result = await tool.execute({ name: "Diseño", status: "archived" }, context);

    expect(result.ok).toBe(false);
  });

  it("returns ok:false with a useful summary for an unparseable start_date", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "create_task");

    const result = await tool.execute({ name: "Diseño", start_date: "not-a-date" }, context);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("not-a-date");
  });
});

describe("update_task", () => {
  it("updates the task resolved by task_id", async () => {
    const { byName, context, repos } = setup();
    const created = await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño" });
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_id: created.id, progress: 50 }, context);

    expect(result.ok).toBe(true);
    expect((await repos.tasks.findById(created.id))?.progress).toBe(50);
  });

  it("resolves by task_name with a case-insensitive exact match", async () => {
    const { byName, context, repos } = setup();
    const created = await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño" });
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_name: "diseño", progress: 20 }, context);

    expect(result.ok).toBe(true);
    expect((await repos.tasks.findById(created.id))?.progress).toBe(20);
  });

  it("resolves by task_name with a unique substring match", async () => {
    const { byName, context, repos } = setup();
    const created = await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño de interfaz" });
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_name: "interfaz", progress: 30 }, context);

    expect(result.ok).toBe(true);
    expect((await repos.tasks.findById(created.id))?.progress).toBe(30);
  });

  it("returns ok:false steering to list_tasks when no task matches task_name", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_name: "nada", progress: 10 }, context);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("list_tasks");
  });

  it("returns ok:false steering to list_tasks when task_name matches multiple tasks", async () => {
    const { byName, context, repos } = setup();
    await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño UI" });
    await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño UX" });
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_name: "Diseño", progress: 10 }, context);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("list_tasks");
  });

  it("never touches a task belonging to a different project", async () => {
    const { byName, context, repos } = setup();
    const foreign = await repos.tasks.create({ projectId: OTHER_PROJECT_ID, name: "Ajeno" });
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_id: foreign.id, progress: 99 }, context);

    expect(result.ok).toBe(false);
    const stillIntact = await repos.tasks.findById(foreign.id);
    expect(stillIntact?.progress).toBe(0);
  });

  it("returns ok:false when neither task_id nor task_name is given", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ progress: 10 }, context);

    expect(result.ok).toBe(false);
  });

  it("returns ok:false when no field to change is given", async () => {
    const { byName, context, repos } = setup();
    const created = await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño" });
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_id: created.id }, context);

    expect(result.ok).toBe(false);
  });

  it("returns ok:false with a useful summary for an unparseable end_date", async () => {
    const { byName, context, repos } = setup();
    const created = await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño" });
    const tool = getTool(byName, "update_task");

    const result = await tool.execute({ task_id: created.id, end_date: "not-a-date" }, context);

    expect(result.ok).toBe(false);
  });
});

describe("delete_task", () => {
  it("deletes the task resolved by task_id", async () => {
    const { byName, context, repos } = setup();
    const created = await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño" });
    const tool = getTool(byName, "delete_task");

    const result = await tool.execute({ task_id: created.id }, context);

    expect(result.ok).toBe(true);
    expect(await repos.tasks.findById(created.id)).toBeNull();
  });

  it("returns ok:false steering to list_tasks when no task matches task_name", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "delete_task");

    const result = await tool.execute({ task_name: "nada" }, context);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("list_tasks");
  });

  it("returns ok:false steering to list_tasks when task_name matches multiple tasks", async () => {
    const { byName, context, repos } = setup();
    await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño UI" });
    await repos.tasks.create({ projectId: PROJECT_ID, name: "Diseño UX" });
    const tool = getTool(byName, "delete_task");

    const result = await tool.execute({ task_name: "Diseño" }, context);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("list_tasks");
  });

  it("never touches a task belonging to a different project", async () => {
    const { byName, context, repos } = setup();
    const foreign = await repos.tasks.create({ projectId: OTHER_PROJECT_ID, name: "Ajeno" });
    const tool = getTool(byName, "delete_task");

    const result = await tool.execute({ task_id: foreign.id }, context);

    expect(result.ok).toBe(false);
    expect(await repos.tasks.findById(foreign.id)).not.toBeNull();
  });

  it("returns ok:false when neither task_id nor task_name is given", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "delete_task");

    const result = await tool.execute({}, context);

    expect(result.ok).toBe(false);
  });
});

describe("list_tasks", () => {
  it("returns only the current project's tasks", async () => {
    const { byName, context, repos } = setup();
    await repos.tasks.create({ projectId: PROJECT_ID, name: "Mío" });
    await repos.tasks.create({ projectId: OTHER_PROJECT_ID, name: "Ajeno" });
    const tool = getTool(byName, "list_tasks");

    const result = await tool.execute({}, context);

    expect(result.ok).toBe(true);
    const data = result.data as Array<{ name: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Mío");
  });

  it("reports an empty project without error", async () => {
    const { byName, context } = setup();
    const tool = getTool(byName, "list_tasks");

    const result = await tool.execute({}, context);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("todavía no tiene tareas");
  });
});

describe("tool definitions", () => {
  it("create_task requires only `name`", () => {
    const tools = createTaskTools();
    const tool = tools.find((t) => t.definition.name === "create_task");
    expect(tool?.definition.parameters).toMatchObject({
      type: "object",
      required: ["name"],
    });
    expect(tool?.definition.parameters.properties).toHaveProperty("name");
  });

  it("update_task exposes task_id/task_name/name/dates/progress/status as optional properties", () => {
    const tools = createTaskTools();
    const tool = tools.find((t) => t.definition.name === "update_task");
    const properties = tool?.definition.parameters.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("task_id");
    expect(properties).toHaveProperty("task_name");
    expect(properties).toHaveProperty("name");
    expect(properties).toHaveProperty("start_date");
    expect(properties).toHaveProperty("end_date");
    expect(properties).toHaveProperty("progress");
    expect(properties).toHaveProperty("status");
    expect(tool?.definition.parameters.required).toBeUndefined();
  });

  it("delete_task exposes task_id/task_name as optional properties", () => {
    const tools = createTaskTools();
    const tool = tools.find((t) => t.definition.name === "delete_task");
    const properties = tool?.definition.parameters.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("task_id");
    expect(properties).toHaveProperty("task_name");
    expect(tool?.definition.parameters.required).toBeUndefined();
  });

  it("list_tasks requires no arguments", () => {
    const tools = createTaskTools();
    const tool = tools.find((t) => t.definition.name === "list_tasks");
    expect(tool?.definition.parameters).toMatchObject({ type: "object" });
    expect(tool?.definition.parameters.required).toBeUndefined();
  });
});
