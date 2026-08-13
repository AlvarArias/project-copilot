import { describe, expect, it } from "vitest";

import { PgMessageRepository } from "@/repositories/message-repository";
import { fakeDb, normalizeSql } from "@/repositories/test-support/fake-db";

const MESSAGE_ID = "60606060-6060-4606-8606-606060606060";
const PROJECT_ID = "70707070-7070-4707-8707-707070707070";

describe("PgMessageRepository.create", () => {
  it("inserts with content and tool_calls defaulted to null when omitted", async () => {
    const { db, calls } = fakeDb([
      {
        rows: [
          {
            id: MESSAGE_ID,
            project_id: PROJECT_ID,
            role: "user",
            content: null,
            tool_calls: null,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    ]);
    const repo = new PgMessageRepository(db);

    await repo.create({ projectId: PROJECT_ID, role: "user" });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("insert into messages (project_id, role, content, tool_calls) values ($1, $2, $3, $4) returning *");
    expect(calls[0].params).toEqual([PROJECT_ID, "user", null, null]);
  });

  it("passes through provided content and toolCalls", async () => {
    const toolCalls = [{ name: "create_task", args: { name: "Do the thing" } }];
    const { db, calls } = fakeDb([
      {
        rows: [
          {
            id: MESSAGE_ID,
            project_id: PROJECT_ID,
            role: "assistant",
            content: "Done.",
            tool_calls: toolCalls,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    ]);
    const repo = new PgMessageRepository(db);

    const message = await repo.create({ projectId: PROJECT_ID, role: "assistant", content: "Done.", toolCalls });

    // Regression: `toolCalls` must reach `pg` pre-serialized. Handing it the
    // raw array makes `pg` emit a Postgres array literal (`{...}`), which the
    // `jsonb` column rejects at runtime with "invalid input syntax for type
    // json" — a failure a fake db can never surface, so it is pinned here.
    expect(calls[0].params).toEqual([PROJECT_ID, "assistant", "Done.", JSON.stringify(toolCalls)]);
    expect(message.role).toBe("assistant");
    expect(message.toolCalls).toEqual(toolCalls);
  });

  it("serializes a non-array toolCalls value and leaves null alone", async () => {
    const { db, calls } = fakeDb([
      {
        rows: [
          {
            id: MESSAGE_ID,
            project_id: PROJECT_ID,
            role: "assistant",
            content: null,
            tool_calls: null,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
      {
        rows: [
          {
            id: MESSAGE_ID,
            project_id: PROJECT_ID,
            role: "assistant",
            content: null,
            tool_calls: null,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    ]);
    const repo = new PgMessageRepository(db);

    await repo.create({ projectId: PROJECT_ID, role: "assistant", toolCalls: { name: "list_tasks" } });
    expect(calls[0].params?.[3]).toBe('{"name":"list_tasks"}');

    await repo.create({ projectId: PROJECT_ID, role: "assistant", toolCalls: null });
    expect(calls[1].params?.[3]).toBeNull();
  });

  it("maps tool_calls -> toolCalls and passes nullable content through", async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            id: MESSAGE_ID,
            project_id: PROJECT_ID,
            role: "user",
            content: null,
            tool_calls: null,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    ]);
    const repo = new PgMessageRepository(db);

    const message = await repo.create({ projectId: PROJECT_ID, role: "user" });

    expect(message).toEqual({
      id: MESSAGE_ID,
      projectId: PROJECT_ID,
      role: "user",
      content: null,
      toolCalls: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });
});

describe("PgMessageRepository.listByProject", () => {
  it("omits the limit clause when limit is not provided", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgMessageRepository(db);

    await repo.listByProject(PROJECT_ID);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("select * from messages where project_id = $1 order by created_at asc");
    expect(calls[0].params).toEqual([PROJECT_ID]);
  });

  it("appends a limit clause with the correct placeholder when limit is provided", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgMessageRepository(db);

    await repo.listByProject(PROJECT_ID, 20);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("select * from messages where project_id = $1 order by created_at asc limit $2");
    expect(calls[0].params).toEqual([PROJECT_ID, 20]);
  });

  it("maps every returned row", async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            id: MESSAGE_ID,
            project_id: PROJECT_ID,
            role: "user",
            content: "Hi",
            tool_calls: null,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    ]);
    const repo = new PgMessageRepository(db);

    const messages = await repo.listByProject(PROJECT_ID);

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(MESSAGE_ID);
  });
});
