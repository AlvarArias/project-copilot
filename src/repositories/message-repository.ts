/**
 * `pg`-backed adapter for {@link MessageRepository}.
 */

import type { Queryable } from "@/db/pool";
import type { MessageRepository } from "@/domain/repositories";
import type { Message, MessageRole, NewMessageInput } from "@/domain/types";

interface MessageRow {
  id: string;
  project_id: string;
  role: string;
  content: string | null;
  tool_calls: unknown | null;
  created_at: string;
}

function mapRow(row: MessageRow): Message {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role as MessageRole,
    content: row.content,
    toolCalls: row.tool_calls,
    createdAt: row.created_at,
  };
}

/** Reads and writes `messages` rows. */
export class PgMessageRepository implements MessageRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: NewMessageInput): Promise<Message> {
    const result = await this.db.query<MessageRow>(
      `insert into messages (project_id, role, content, tool_calls)
       values ($1, $2, $3, $4)
       returning *`,
      [input.projectId, input.role, input.content ?? null, input.toolCalls ?? null],
    );
    return mapRow(result.rows[0]);
  }

  async listByProject(projectId: string, limit?: number): Promise<Message[]> {
    const values: unknown[] = [projectId];
    let sql = `select * from messages where project_id = $1 order by created_at asc`;
    if (limit !== undefined) {
      values.push(limit);
      sql += ` limit $${values.length}`;
    }
    const result = await this.db.query<MessageRow>(sql, values);
    return result.rows.map(mapRow);
  }
}
