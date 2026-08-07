/**
 * `pg`-backed adapter for {@link DocumentRepository}.
 */

import type { Queryable } from "@/db/pool";
import type { DocumentRepository } from "@/domain/repositories";
import type { Document, DocumentStatus, NewDocumentInput } from "@/domain/types";

interface DocumentRow {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string | null;
  uploaded_at: string;
  status: string;
}

function mapRow(row: DocumentRow): Document {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    mimeType: row.mime_type,
    uploadedAt: row.uploaded_at,
    status: row.status as DocumentStatus,
  };
}

/** Reads and writes `documents` rows. */
export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: NewDocumentInput): Promise<Document> {
    const columns = ["project_id", "filename"];
    const values: unknown[] = [input.projectId, input.filename];

    const addIfPresent = (column: string, value: unknown) => {
      if (value !== undefined) {
        columns.push(column);
        values.push(value);
      }
    };
    addIfPresent("mime_type", input.mimeType);
    addIfPresent("status", input.status);

    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await this.db.query<DocumentRow>(
      `insert into documents (${columns.join(", ")}) values (${placeholders.join(", ")}) returning *`,
      values,
    );
    return mapRow(result.rows[0]);
  }

  async updateStatus(id: string, status: DocumentStatus): Promise<Document | null> {
    const result = await this.db.query<DocumentRow>(
      `update documents set status = $1 where id = $2 returning *`,
      [status, id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findById(id: string): Promise<Document | null> {
    const result = await this.db.query<DocumentRow>(`select * from documents where id = $1`, [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByProject(projectId: string): Promise<Document[]> {
    const result = await this.db.query<DocumentRow>(
      `select * from documents where project_id = $1 order by uploaded_at desc`,
      [projectId],
    );
    return result.rows.map(mapRow);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.query(`delete from documents where id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
