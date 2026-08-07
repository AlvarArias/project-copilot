/**
 * `pg`-backed adapter for {@link TaskDependencyRepository}.
 */

import type { Queryable } from "@/db/pool";
import type { TaskDependencyRepository } from "@/domain/repositories";
import type { TaskDependency } from "@/domain/types";

interface TaskDependencyRow {
  task_id: string;
  depends_on_id: string;
}

function mapRow(row: TaskDependencyRow): TaskDependency {
  return {
    taskId: row.task_id,
    dependsOnId: row.depends_on_id,
  };
}

/** Reads and writes `task_dependencies` rows. */
export class PgTaskDependencyRepository implements TaskDependencyRepository {
  constructor(private readonly db: Queryable) {}

  async add(taskId: string, dependsOnId: string): Promise<TaskDependency> {
    const result = await this.db.query<TaskDependencyRow>(
      `insert into task_dependencies (task_id, depends_on_id) values ($1, $2) returning *`,
      [taskId, dependsOnId],
    );
    return mapRow(result.rows[0]);
  }

  async remove(taskId: string, dependsOnId: string): Promise<boolean> {
    const result = await this.db.query(
      `delete from task_dependencies where task_id = $1 and depends_on_id = $2`,
      [taskId, dependsOnId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listByProject(projectId: string): Promise<TaskDependency[]> {
    const result = await this.db.query<TaskDependencyRow>(
      `select d.task_id, d.depends_on_id
       from task_dependencies d
       join tasks t on t.id = d.task_id
       where t.project_id = $1`,
      [projectId],
    );
    return result.rows.map(mapRow);
  }

  async listForTask(taskId: string): Promise<TaskDependency[]> {
    const result = await this.db.query<TaskDependencyRow>(
      `select * from task_dependencies where task_id = $1`,
      [taskId],
    );
    return result.rows.map(mapRow);
  }

  async listDependents(taskId: string): Promise<TaskDependency[]> {
    const result = await this.db.query<TaskDependencyRow>(
      `select * from task_dependencies where depends_on_id = $1`,
      [taskId],
    );
    return result.rows.map(mapRow);
  }
}
