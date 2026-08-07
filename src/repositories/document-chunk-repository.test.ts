import { describe, expect, it } from "vitest";

import type { NewChunkInput } from "@/domain/types";
import { PgDocumentChunkRepository } from "@/repositories/document-chunk-repository";
import { fakeDb, normalizeSql } from "@/repositories/test-support/fake-db";

const DOCUMENT_ID = "20202020-2020-4202-8202-202020202020";
const PROJECT_ID = "30303030-3030-4303-8303-303030303030";

function makeChunk(overrides: Partial<NewChunkInput> = {}): NewChunkInput {
  return {
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    chunkIndex: 0,
    content: "Some extracted text.",
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

describe("PgDocumentChunkRepository.insertMany", () => {
  it("returns [] without querying when given an empty array", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentChunkRepository(db);

    const chunks = await repo.insertMany([]);

    expect(chunks).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("builds one INSERT with correct placeholder arithmetic for N chunks, casting the embedding column ::vector", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentChunkRepository(db);

    await repo.insertMany([
      makeChunk({ chunkIndex: 0, content: "First", embedding: [0.1, 0.2] }),
      makeChunk({ chunkIndex: 1, content: "Second", embedding: [0.3, 0.4] }),
    ]);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toBe(
      "insert into document_chunks (document_id, project_id, chunk_index, content, token_count, embedding) " +
        "values ($1, $2, $3, $4, $5, $6::vector), ($7, $8, $9, $10, $11, $12::vector) " +
        "returning id, document_id, project_id, chunk_index, content, token_count",
    );
    expect(calls[0].params).toEqual([
      DOCUMENT_ID,
      PROJECT_ID,
      0,
      "First",
      null,
      "[0.1,0.2]",
      DOCUMENT_ID,
      PROJECT_ID,
      1,
      "Second",
      null,
      "[0.3,0.4]",
    ]);
  });

  it("serializes the embedding to the pgvector literal string", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentChunkRepository(db);

    await repo.insertMany([makeChunk({ embedding: [0.1, 0.2, 0.3] })]);

    // Last param of the single row is the vector literal.
    expect(calls[0].params?.at(-1)).toBe("[0.1,0.2,0.3]");
  });

  it("defaults tokenCount to null when omitted, and passes it through when provided", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentChunkRepository(db);

    await repo.insertMany([makeChunk({ tokenCount: 42 })]);

    expect(calls[0].params?.[4]).toBe(42);
  });

  it("maps returned rows to DocumentChunk, with no embedding field", async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            id: "40404040-4040-4404-8404-404040404040",
            document_id: DOCUMENT_ID,
            project_id: PROJECT_ID,
            chunk_index: 0,
            content: "First",
            token_count: 12,
          },
        ],
      },
    ]);
    const repo = new PgDocumentChunkRepository(db);

    const chunks = await repo.insertMany([makeChunk()]);

    expect(chunks).toEqual([
      {
        id: "40404040-4040-4404-8404-404040404040",
        documentId: DOCUMENT_ID,
        projectId: PROJECT_ID,
        chunkIndex: 0,
        content: "First",
        tokenCount: 12,
      },
    ]);
    expect(chunks[0]).not.toHaveProperty("embedding");
  });
});

describe("PgDocumentChunkRepository.searchSimilar", () => {
  it("passes [projectId, vectorLiteral, topK] as params", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentChunkRepository(db);

    await repo.searchSimilar(PROJECT_ID, [0.5, 0.6], 5);

    expect(calls[0].params).toEqual([PROJECT_ID, "[0.5,0.6]", 5]);
  });

  it("filters by project and non-null embedding, ordering by distance with a limit", async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    const repo = new PgDocumentChunkRepository(db);

    await repo.searchSimilar(PROJECT_ID, [0.5, 0.6], 5);

    const sql = normalizeSql(calls[0].text);
    expect(sql).toContain("where c.project_id = $1 and c.embedding is not null");
    expect(sql).toContain("order by c.embedding <=> $2::vector");
    expect(sql).toContain("limit $3");
  });

  it("maps rows to ChunkSearchResult, including filename and similarity", async () => {
    const { db } = fakeDb([
      {
        rows: [
          {
            id: "50505050-5050-4505-8505-505050505050",
            document_id: DOCUMENT_ID,
            project_id: PROJECT_ID,
            chunk_index: 2,
            content: "Relevant text",
            token_count: 30,
            filename: "spec.pdf",
            similarity: 0.87,
          },
        ],
      },
    ]);
    const repo = new PgDocumentChunkRepository(db);

    const results = await repo.searchSimilar(PROJECT_ID, [0.5, 0.6], 5);

    expect(results).toEqual([
      {
        id: "50505050-5050-4505-8505-505050505050",
        documentId: DOCUMENT_ID,
        projectId: PROJECT_ID,
        chunkIndex: 2,
        content: "Relevant text",
        tokenCount: 30,
        filename: "spec.pdf",
        similarity: 0.87,
      },
    ]);
  });
});

describe("PgDocumentChunkRepository.deleteByDocument", () => {
  it("returns the row count on success", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 3 }]);
    const repo = new PgDocumentChunkRepository(db);

    const deleted = await repo.deleteByDocument(DOCUMENT_ID);

    expect(normalizeSql(calls[0].text)).toBe("delete from document_chunks where document_id = $1");
    expect(calls[0].params).toEqual([DOCUMENT_ID]);
    expect(deleted).toBe(3);
  });

  it("returns 0 when rowCount is null", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: null }]);
    const repo = new PgDocumentChunkRepository(db);

    expect(await repo.deleteByDocument(DOCUMENT_ID)).toBe(0);
  });
});
