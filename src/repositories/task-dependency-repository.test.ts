import { describe, expect, it } from "vitest";

import { PgTaskDependencyRepository } from "@/repositories/task-dependency-repository";
import { fakeDb, normalizeSql } from "@/repositories/test-support/fake-db";

const TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEPENDS_ON_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("PgTaskDependencyRepository", () => {
  it("add() inserts and maps the returned row", async () => {
    const { db, calls } = fakeDb([
      { rows: [{ task_id: TASK_ID, depends_on_id: DEPENDS_ON_ID }] },
    ]);
    const repo = new PgTaskDependencyRepository(db);

    const dep = await repo.add(TASK_ID, DEPENDS_ON_ID);

    expect(normalizeSql(calls[0].text)).toBe(
      "insert into task_dependencies (task_id, depends_on_id) values ($1, $2) returning *",
    );
    expect(calls[0].params).toEqual([TASK_ID, DEPENDS_ON_ID]);
    expect(dep).toEqual({ taskId: TASK_ID, dependsOnId: DEPENDS_ON_ID });
  });

  it("remove() returns true when rowCount > 0", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    const repo = new PgTaskDependencyRepository(db);

    const removed = await repo.remove(TASK_ID, DEPENDS_ON_ID);

    expect(normalizeSql(calls[0].text)).toBe(
      "delete from task_dependencies where task_id = $1 and depends_on_id = $2",
    );
    expect(calls[0].params).toEqual([TASK_ID, DEPENDS_ON_ID]);
    expect(removed).toBe(true);
  });

  it("remove() returns false when rowCount is 0", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    const repo = new PgTaskDependencyRepository(db);

    expect(await repo.remove(TASK_ID, DEPENDS_ON_ID)).toBe(false);
  });

  it("remove() returns false when rowCount is null", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: null }]);
    const repo = new PgTaskDependencyRepository(db);

    expect(await repo.remove(TASK_ID, DEPENDS_ON_ID)).toBe(false);
  });

  it("listByProject() joins tasks and filters by project_id", async () => {
    const { db, calls } = fakeDb([
      { rows: [{ task_id: TASK_ID, depends_on_id: DEPENDS_ON_ID }] },
    ]);
    const repo = new PgTaskDependencyRepository(db);

    const deps = await repo.listByProject(PROJECT_ID);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe(
      "select d.task_id, d.depends_on_id from task_dependencies d join tasks t on t.id = d.task_id where t.project_id = $1",
    );
    expect(calls[0].params).toEqual([PROJECT_ID]);
    expect(deps).toEqual([{ taskId: TASK_ID, dependsOnId: DEPENDS_ON_ID }]);
  });

  it("listForTask() filters on task_id — what this task depends on", async () => {
    const { db, calls } = fakeDb([
      { rows: [{ task_id: TASK_ID, depends_on_id: DEPENDS_ON_ID }] },
    ]);
    const repo = new PgTaskDependencyRepository(db);

    await repo.listForTask(TASK_ID);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("select * from task_dependencies where task_id = $1");
    expect(calls[0].params).toEqual([TASK_ID]);
  });

  it("listDependents() filters on depends_on_id — what breaks if this task is deleted", async () => {
    const { db, calls } = fakeDb([
      { rows: [{ task_id: TASK_ID, depends_on_id: DEPENDS_ON_ID }] },
    ]);
    const repo = new PgTaskDependencyRepository(db);

    await repo.listDependents(TASK_ID);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("select * from task_dependencies where depends_on_id = $1");
    expect(calls[0].params).toEqual([TASK_ID]);
  });

  it("listForTask() and listDependents() query distinct columns (regression guard against a swap)", async () => {
    const forTask = fakeDb([{ rows: [] }]);
    const dependents = fakeDb([{ rows: [] }]);

    await new PgTaskDependencyRepository(forTask.db).listForTask(TASK_ID);
    await new PgTaskDependencyRepository(dependents.db).listDependents(TASK_ID);

    expect(normalizeSql(forTask.calls[0].text)).toContain("task_id = $1");
    expect(normalizeSql(forTask.calls[0].text)).not.toContain("depends_on_id = $1");
    expect(normalizeSql(dependents.calls[0].text)).toContain("depends_on_id = $1");
    expect(normalizeSql(dependents.calls[0].text)).not.toMatch(/where task_id = \$1/);
  });
});
