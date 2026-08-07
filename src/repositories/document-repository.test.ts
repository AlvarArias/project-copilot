import { describe, expect, it } from "vitest";

import { PgDocumentRepository } from "@/repositories/document-repository";
import { fakeDb, normalizeSql } from "@/repositories/test-support/fake-db";

const DOCUMENT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PROJECT_ID = "10101010-1010-4101-8101-101010101010";

const DOCUMENT_ROW = {
  id: DOCUMENT_ID,
  project_id: PROJECT_ID,
  filename: "spec.pdf",
  mime_type: "application/pdf",
  uploaded_at: "2026-09-01T00:00:00.000Z",
  status: "ready",
};

describe("PgDocumentRepository.create", () => {
  it("omits optional fields left undefined", async () => {
    const { db, calls } = fakeDb([{ rows: [DOCUMENT_ROW] }]);
    const repo = new PgDocumentRepository(db);

    await repo.create({ projectId: PROJECT_ID, filename: "spec.pdf" });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe("insert into documents (project_id, filename) values ($1, $2) returning *");
    expect(calls[0].params).toEqual([PROJECT_ID, "spec.pdf"]);
  });

  it("includes provided optional fields in order", async () => {
    const { db, calls } = fakeDb([{ rows: [DOCUMENT_ROW] }]);
    const repo = new PgDocumentRepository(db);

    await repo.create({
      projectId: PROJECT_ID,
      filename: "spec.pdf",
      mimeType: "application/pdf",
      status: "processing",
    });

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe(
      "insert into documents (project_id, filename, mime_type, status) values ($1, $2, $3, $4) returning *",
    );
    expect(calls[0].params).toEqual([PROJECT_ID, "spec.pdf", "application/pdf", "processing"]);
  });

  it("maps the returned row, including nullable mime_type", async () => {
    const { db } = fakeDb([{ rows: [{ ...DOCUMENT_ROW, mime_type: null }] }]);
    const repo = new PgDocumentRepository(db);

    const doc = await repo.create({ projectId: PROJECT_ID, filename: "spec.pdf" });

    expect(doc).toEqual({
      id: DOCUMENT_ID,
      projectId: PROJECT_ID,
      filename: "spec.pdf",
      mimeType: null,
      uploadedAt: "2026-09-01T00:00:00.000Z",
      status: "ready",
    });
  });
});

describe("PgDocumentRepository.updateStatus", () => {
  it("updates the status column and maps the row", async () => {
    const { db, calls } = fakeDb([{ rows: [{ ...DOCUMENT_ROW, status: "error" }] }]);
    const repo = new PgDocumentRepository(db);

    const doc = await repo.updateStatus(DOCUMENT_ID, "error");

    expect(normalizeSql(calls[0].text)).toBe("update documents set status = $1 where id = $2 returning *");
    expect(calls[0].params).toEqual(["error", DOCUMENT_ID]);
    expect(doc?.status).toBe("error");
  });

  it("returns null when no row matches", async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentRepository(db);

    expect(await repo.updateStatus(DOCUMENT_ID, "ready")).toBeNull();
  });
});

describe("PgDocumentRepository.findById / listByProject / delete", () => {
  it("findById() returns null on no match", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentRepository(db);

    expect(await repo.findById(DOCUMENT_ID)).toBeNull();
    expect(normalizeSql(calls[0].text)).toBe("select * from documents where id = $1");
  });

  it("listByProject() orders by uploaded_at desc", async () => {
    const { db, calls } = fakeDb([{ rows: [DOCUMENT_ROW] }]);
    const repo = new PgDocumentRepository(db);

    const docs = await repo.listByProject(PROJECT_ID);

    expect(normalizeSql(calls[0].text)).toBe(
      "select * from documents where project_id = $1 order by uploaded_at desc",
    );
    expect(calls[0].params).toEqual([PROJECT_ID]);
    expect(docs).toHaveLength(1);
  });

  it("delete() returns true when rowCount > 0 and false otherwise", async () => {
    const removed = fakeDb([{ rows: [], rowCount: 1 }]);
    const notRemoved = fakeDb([{ rows: [], rowCount: 0 }]);
    const nullCount = fakeDb([{ rows: [], rowCount: null }]);

    expect(await new PgDocumentRepository(removed.db).delete(DOCUMENT_ID)).toBe(true);
    expect(await new PgDocumentRepository(notRemoved.db).delete(DOCUMENT_ID)).toBe(false);
    expect(await new PgDocumentRepository(nullCount.db).delete(DOCUMENT_ID)).toBe(false);
  });
});
