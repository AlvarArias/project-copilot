import { describe, expect, it } from "vitest";

import { PgProjectRepository } from "@/repositories/project-repository";
import { fakeDb, normalizeSql } from "@/repositories/test-support/fake-db";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("PgProjectRepository", () => {
  it("create() inserts and maps the returned row", async () => {
    const { db, calls } = fakeDb([
      {
        rows: [{ id: PROJECT_ID, name: "Apollo", created_at: "2026-09-01T00:00:00.000Z" }],
      },
    ]);
    const repo = new PgProjectRepository(db);

    const project = await repo.create({ name: "Apollo" });

    expect(normalizeSql(calls[0].text)).toBe("insert into projects (name) values ($1) returning *");
    expect(calls[0].params).toEqual(["Apollo"]);
    expect(project).toEqual({
      id: PROJECT_ID,
      name: "Apollo",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("findById() returns null when no row matches", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgProjectRepository(db);

    const project = await repo.findById(PROJECT_ID);

    expect(normalizeSql(calls[0].text)).toBe("select * from projects where id = $1");
    expect(calls[0].params).toEqual([PROJECT_ID]);
    expect(project).toBeNull();
  });

  it("findByName() issues a `limit 1` query ordered by created_at", async () => {
    const { db, calls } = fakeDb([
      { rows: [{ id: PROJECT_ID, name: "Apollo", created_at: "2026-09-01" }] },
    ]);
    const repo = new PgProjectRepository(db);

    const project = await repo.findByName("Apollo");

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("select * from projects where name = $1 order by created_at asc limit 1");
    expect(calls[0].params).toEqual(["Apollo"]);
    expect(project?.id).toBe(PROJECT_ID);
  });

  it("findByName() returns null on no rows", async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const repo = new PgProjectRepository(db);

    const project = await repo.findByName("Nonexistent");

    expect(project).toBeNull();
  });

  it("list() maps every row", async () => {
    const { db, calls } = fakeDb([
      {
        rows: [
          { id: PROJECT_ID, name: "Apollo", created_at: "2026-09-01" },
          { id: "22222222-2222-4222-8222-222222222222", name: "Zeus", created_at: "2026-09-02" },
        ],
      },
    ]);
    const repo = new PgProjectRepository(db);

    const projects = await repo.list();

    expect(normalizeSql(calls[0].text)).toBe("select * from projects order by created_at asc");
    expect(projects).toHaveLength(2);
    expect(projects[1]).toEqual({ id: "22222222-2222-4222-8222-222222222222", name: "Zeus", createdAt: "2026-09-02" });
  });

  it("delete() returns true when a row was removed", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    const repo = new PgProjectRepository(db);

    const deleted = await repo.delete(PROJECT_ID);

    expect(normalizeSql(calls[0].text)).toBe("delete from projects where id = $1");
    expect(deleted).toBe(true);
  });

  it("delete() returns false when no row was removed", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    const repo = new PgProjectRepository(db);

    expect(await repo.delete(PROJECT_ID)).toBe(false);
  });

  it("delete() returns false when rowCount is null", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: null }]);
    const repo = new PgProjectRepository(db);

    expect(await repo.delete(PROJECT_ID)).toBe(false);
  });
});
