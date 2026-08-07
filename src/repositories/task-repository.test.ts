import { describe, expect, it } from "vitest";

import { PgTaskRepository } from "@/repositories/task-repository";
import { fakeDb, normalizeSql } from "@/repositories/test-support/fake-db";

const TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const TASK_ROW = {
  id: TASK_ID,
  project_id: PROJECT_ID,
  name: "Design review",
  start_date: "2026-09-01",
  end_date: "2026-09-05",
  progress: 50,
  status: "in_progress",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
};

describe("PgTaskRepository.create", () => {
  it("omits optional fields that are undefined, leaving DB defaults to apply", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    await repo.create({ projectId: PROJECT_ID, name: "Design review" });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("insert into tasks (project_id, name) values ($1, $2) returning *");
    expect(calls[0].params).toEqual([PROJECT_ID, "Design review"]);
  });

  it("includes provided optional fields, in declaration order, with matching placeholders", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    await repo.create({
      projectId: PROJECT_ID,
      name: "Design review",
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      progress: 50,
      status: "in_progress",
    });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe(
      "insert into tasks (project_id, name, start_date, end_date, progress, status) values ($1, $2, $3, $4, $5, $6) returning *",
    );
    expect(calls[0].params).toEqual([PROJECT_ID, "Design review", "2026-09-01", "2026-09-05", 50, "in_progress"]);
  });

  it("includes a partial set of optional fields in the order they're checked", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    await repo.create({ projectId: PROJECT_ID, name: "Design review", status: "planned" });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("insert into tasks (project_id, name, status) values ($1, $2, $3) returning *");
    expect(calls[0].params).toEqual([PROJECT_ID, "Design review", "planned"]);
  });

  it("maps the returned row from snake_case to camelCase, passing dates through as strings", async () => {
    const { db } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    const task = await repo.create({ projectId: PROJECT_ID, name: "Design review" });

    expect(task).toEqual({
      id: TASK_ID,
      projectId: PROJECT_ID,
      name: "Design review",
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      progress: 50,
      status: "in_progress",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
  });
});

describe("PgTaskRepository.update", () => {
  it("builds the SET clause, placeholders, and params in patch-key order for a multi-field patch", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    await repo.update(TASK_ID, { name: "Renamed", progress: 75, status: "done" });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("update tasks set name = $1, progress = $2, status = $3 where id = $4 returning *");
    expect(calls[0].params).toEqual(["Renamed", 75, "done", TASK_ID]);
  });

  it("treats an explicit `startDate: null` as a SET clause, not a skip", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    await repo.update(TASK_ID, { startDate: null, name: "Renamed" });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("update tasks set start_date = $1, name = $2 where id = $3 returning *");
    expect(calls[0].params).toEqual([null, "Renamed", TASK_ID]);
  });

  it("skips keys that are omitted from the patch entirely", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    await repo.update(TASK_ID, { progress: 10 });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("update tasks set progress = $1 where id = $2 returning *");
    expect(calls[0].params).toEqual([10, TASK_ID]);
  });

  it("falls back to findById (no UPDATE issued) for an empty patch", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    const task = await repo.update(TASK_ID, {});

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("select * from tasks where id = $1");
    expect(sql).not.toMatch(/^update/);
    expect(calls[0].params).toEqual([TASK_ID]);
    expect(task?.id).toBe(TASK_ID);
  });

  it("returns null when the update matches no row", async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const repo = new PgTaskRepository(db);

    const task = await repo.update(TASK_ID, { progress: 10 });

    expect(task).toBeNull();
  });

  it("returns null when the empty-patch fallback finds no row", async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const repo = new PgTaskRepository(db);

    const task = await repo.update(TASK_ID, {});

    expect(task).toBeNull();
  });
});

describe("PgTaskRepository.delete", () => {
  it("returns true when rowCount > 0", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    const repo = new PgTaskRepository(db);

    const deleted = await repo.delete(TASK_ID);

    expect(normalizeSql(calls[0].text)).toBe("delete from tasks where id = $1");
    expect(deleted).toBe(true);
  });

  it("returns false when rowCount is 0", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    const repo = new PgTaskRepository(db);

    expect(await repo.delete(TASK_ID)).toBe(false);
  });

  it("returns false when rowCount is null", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: null }]);
    const repo = new PgTaskRepository(db);

    expect(await repo.delete(TASK_ID)).toBe(false);
  });
});

describe("PgTaskRepository.findById / listByProject", () => {
  it("findById() returns null when no row matches", async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const repo = new PgTaskRepository(db);

    expect(await repo.findById(TASK_ID)).toBeNull();
  });

  it("listByProject() orders by start_date (nulls last) then created_at, and maps every row", async () => {
    const { db, calls } = fakeDb([{ rows: [TASK_ROW] }]);
    const repo = new PgTaskRepository(db);

    const tasks = await repo.listByProject(PROJECT_ID);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("select * from tasks where project_id = $1 order by start_date asc nulls last, created_at asc");
    expect(calls[0].params).toEqual([PROJECT_ID]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(TASK_ID);
  });
});
