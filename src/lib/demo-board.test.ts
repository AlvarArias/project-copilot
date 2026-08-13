import { describe, expect, it, vi } from "vitest";

import { getDemoBoard } from "@/lib/demo-board";
import { DEMO_PROJECT_NAME } from "@/domain/demo-project";
import type { ProjectRepository, Repositories, TaskRepository } from "@/domain/repositories";
import type { Project, Task } from "@/domain/types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: DEMO_PROJECT_NAME,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "project-1",
    name: "Design review",
    startDate: "2026-09-01",
    endDate: "2026-09-05",
    progress: 50,
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

/** A spy that fails the test loudly if `getDemoBoard` calls it when it shouldn't. */
function notImplemented(label: string) {
  return vi.fn(async () => {
    throw new Error(`${label} should not be called in this test`);
  });
}

function makeProjectRepo(overrides: Partial<ProjectRepository> = {}): ProjectRepository {
  return {
    create: notImplemented("projects.create"),
    findById: notImplemented("projects.findById"),
    findByName: notImplemented("projects.findByName"),
    list: notImplemented("projects.list"),
    delete: notImplemented("projects.delete"),
    ...overrides,
  };
}

function makeTaskRepo(overrides: Partial<TaskRepository> = {}): TaskRepository {
  return {
    create: notImplemented("tasks.create"),
    update: notImplemented("tasks.update"),
    delete: notImplemented("tasks.delete"),
    findById: notImplemented("tasks.findById"),
    listByProject: notImplemented("tasks.listByProject"),
    ...overrides,
  };
}

/**
 * `getDemoBoard` only ever touches `repos.projects` and `repos.tasks`
 * (see `src/lib/demo-board.ts`), so the other four repositories are stubbed
 * out with `unknown` casts rather than hand-written fakes — there's nothing
 * for them to fake.
 */
function makeRepos(projects: Partial<ProjectRepository> = {}, tasks: Partial<TaskRepository> = {}): Repositories {
  return {
    projects: makeProjectRepo(projects),
    tasks: makeTaskRepo(tasks),
    taskDependencies: {} as unknown as Repositories["taskDependencies"],
    documents: {} as unknown as Repositories["documents"],
    documentChunks: {} as unknown as Repositories["documentChunks"],
    messages: {} as unknown as Repositories["messages"],
  };
}

describe("getDemoBoard", () => {
  it("resolves the shared demo project by name (via DEMO_PROJECT_NAME, not a hardcoded string) when projectId is omitted", async () => {
    const project = makeProject();
    const findByName = vi.fn(async () => project);
    const listByProject = vi.fn(async () => []);
    const repos = makeRepos({ findByName }, { listByProject });

    await getDemoBoard(undefined, repos);

    expect(findByName).toHaveBeenCalledWith(DEMO_PROJECT_NAME);
  });

  it("resolves the project by id via findById when projectId is supplied", async () => {
    const project = makeProject({ id: "project-42" });
    const findById = vi.fn(async () => project);
    const listByProject = vi.fn(async () => []);
    const repos = makeRepos({ findById }, { listByProject });

    await getDemoBoard("project-42", repos);

    expect(findById).toHaveBeenCalledWith("project-42");
  });

  it("returns null and never queries tasks when the demo project isn't found by name", async () => {
    const findByName = vi.fn(async () => null);
    const listByProject = vi.fn(async () => []);
    const repos = makeRepos({ findByName }, { listByProject });

    const board = await getDemoBoard(undefined, repos);

    expect(board).toBeNull();
    expect(listByProject).not.toHaveBeenCalled();
  });

  it("returns null and never queries tasks when the project isn't found by id", async () => {
    const findById = vi.fn(async () => null);
    const listByProject = vi.fn(async () => []);
    const repos = makeRepos({ findById }, { listByProject });

    const board = await getDemoBoard("missing-id", repos);

    expect(board).toBeNull();
    expect(listByProject).not.toHaveBeenCalled();
  });

  it("returns the project together with its tasks on the happy path", async () => {
    const project = makeProject();
    const tasks = [makeTask(), makeTask({ id: "task-2", name: "Build backend" })];
    const findByName = vi.fn(async () => project);
    const listByProject = vi.fn(async () => tasks);
    const repos = makeRepos({ findByName }, { listByProject });

    const board = await getDemoBoard(undefined, repos);

    expect(board).toEqual({ project, tasks });
    expect(listByProject).toHaveBeenCalledWith(project.id);
  });
});
