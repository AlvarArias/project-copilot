/**
 * `pg`-backed adapter for {@link TaskRepository}.
 */

import type { Queryable } from "@/db/pool";
import type { TaskRepository } from "@/domain/repositories";
import type { NewTaskInput, Task, TaskPatch, TaskStatus } from "@/domain/types";

interface TaskRow {
  id: string;
  project_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  progress: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    progress: row.progress,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Maps {@link TaskPatch} keys to their `tasks` column names. */
const PATCH_COLUMNS: Record<keyof TaskPatch, string> = {
  name: "name",
  startDate: "start_date",
  endDate: "end_date",
  progress: "progress",
  status: "status",
};

/** Reads and writes `tasks` rows. */
export class PgTaskRepository implements TaskRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: NewTaskInput): Promise<Task> {
    const columns = ["project_id", "name"];
    const values: unknown[] = [input.projectId, input.name];

    const addIfPresent = (column: string, value: unknown) => {
      if (value !== undefined) {
        columns.push(column);
        values.push(value);
      }
    };
    addIfPresent("start_date", input.startDate);
    addIfPresent("end_date", input.endDate);
    addIfPresent("progress", input.progress);
    addIfPresent("status", input.status);

    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await this.db.query<TaskRow>(
      `insert into tasks (${columns.join(", ")}) values (${placeholders.join(", ")}) returning *`,
      values,
    );
    return mapRow(result.rows[0]);
  }

  async update(id: string, patch: TaskPatch): Promise<Task | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      values.push(value);
      setClauses.push(`${PATCH_COLUMNS[key]} = $${values.length}`);
    }

    if (setClauses.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await this.db.query<TaskRow>(
      `update tasks set ${setClauses.join(", ")} where id = $${values.length} returning *`,
      values,
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.query(`delete from tasks where id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async findById(id: string): Promise<Task | null> {
    const result = await this.db.query<TaskRow>(`select * from tasks where id = $1`, [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listByProject(projectId: string): Promise<Task[]> {
    const result = await this.db.query<TaskRow>(
      `select * from tasks where project_id = $1 order by start_date asc nulls last, created_at asc`,
      [projectId],
    );
    return result.rows.map(mapRow);
  }
}
