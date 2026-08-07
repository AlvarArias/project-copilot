import { describe, expect, it } from "vitest";

import {
  createRepositories,
  PgDocumentChunkRepository,
  PgDocumentRepository,
  PgMessageRepository,
  PgProjectRepository,
  PgTaskDependencyRepository,
  PgTaskRepository,
} from "@/repositories";
import { fakeDb } from "@/repositories/test-support/fake-db";

describe("createRepositories", () => {
  it("wires all six repositories to the same injected db", async () => {
    const { db, calls } = fakeDb([{ rows: [] }, { rows: [] }]);

    const repos = createRepositories(db);

    expect(repos.projects).toBeInstanceOf(PgProjectRepository);
    expect(repos.tasks).toBeInstanceOf(PgTaskRepository);
    expect(repos.taskDependencies).toBeInstanceOf(PgTaskDependencyRepository);
    expect(repos.documents).toBeInstanceOf(PgDocumentRepository);
    expect(repos.documentChunks).toBeInstanceOf(PgDocumentChunkRepository);
    expect(repos.messages).toBeInstanceOf(PgMessageRepository);

    // Two independent repositories issuing queries both hit the same fake,
    // confirming they share the injected `db` rather than each creating
    // their own connection.
    await repos.projects.list();
    await repos.documents.listByProject("11111111-1111-4111-8111-111111111111");

    expect(calls).toHaveLength(2);
  });
});
