/**
 * `pg`-backed adapter for {@link DocumentChunkRepository}.
 */

import type { Queryable } from "@/db/pool";
import type { DocumentChunkRepository } from "@/domain/repositories";
import type { ChunkSearchResult, DocumentChunk, NewChunkInput } from "@/domain/types";

interface DocumentChunkRow {
  id: string;
  document_id: string;
  project_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
}

interface ChunkSearchRow extends DocumentChunkRow {
  filename: string;
  similarity: number;
}

function mapRow(row: DocumentChunkRow): DocumentChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    projectId: row.project_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tokenCount: row.token_count,
  };
}

function mapSearchRow(row: ChunkSearchRow): ChunkSearchResult {
  return {
    ...mapRow(row),
    filename: row.filename,
    similarity: row.similarity,
  };
}

/** Serializes an embedding to the pgvector text literal format, e.g. `[0.1,0.2,...]`. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Reads and writes `document_chunks` rows, including pgvector similarity search. */
export class PgDocumentChunkRepository implements DocumentChunkRepository {
  constructor(private readonly db: Queryable) {}

  async insertMany(chunks: NewChunkInput[]): Promise<DocumentChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const values: unknown[] = [];
    const rowPlaceholders = chunks.map((chunk) => {
      const params = [
        chunk.documentId,
        chunk.projectId,
        chunk.chunkIndex,
        chunk.content,
        chunk.tokenCount ?? null,
        toVectorLiteral(chunk.embedding),
      ];
      const placeholders = params.map((_, index) => {
        const position = values.length + index + 1;
        return index === params.length - 1 ? `$${position}::vector` : `$${position}`;
      });
      values.push(...params);
      return `(${placeholders.join(", ")})`;
    });

    const result = await this.db.query<DocumentChunkRow>(
      `insert into document_chunks (document_id, project_id, chunk_index, content, token_count, embedding)
       values ${rowPlaceholders.join(", ")}
       returning id, document_id, project_id, chunk_index, content, token_count`,
      values,
    );
    return result.rows.map(mapRow);
  }

  async searchSimilar(projectId: string, embedding: number[], topK: number): Promise<ChunkSearchResult[]> {
    const result = await this.db.query<ChunkSearchRow>(
      `select c.id, c.document_id, c.project_id, c.chunk_index, c.content, c.token_count,
              d.filename,
              1 - (c.embedding <=> $2::vector) as similarity
       from document_chunks c
       join documents d on d.id = c.document_id
       where c.project_id = $1 and c.embedding is not null
       order by c.embedding <=> $2::vector
       limit $3`,
      [projectId, toVectorLiteral(embedding), topK],
    );
    return result.rows.map(mapSearchRow);
  }

  async deleteByDocument(documentId: string): Promise<number> {
    const result = await this.db.query(`delete from document_chunks where document_id = $1`, [documentId]);
    return result.rowCount ?? 0;
  }
}
