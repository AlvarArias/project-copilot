/**
 * `pg`-backed adapter for {@link ProjectRepository}.
 */

import type { Queryable } from "@/db/pool";
import type { ProjectRepository } from "@/domain/repositories";
import type { Project } from "@/domain/types";

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
}

function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

/** Reads and writes `projects` rows. */
export class PgProjectRepository implements ProjectRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: { name: string }): Promise<Project> {
    const result = await this.db.query<ProjectRow>(
      `insert into projects (name) values ($1) returning *`,
      [input.name],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<Project | null> {
    const result = await this.db.query<ProjectRow>(`select * from projects where id = $1`, [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByName(name: string): Promise<Project | null> {
    // `projects.name` is not unique, so pin a deterministic winner (the
    // oldest) — the seed script relies on this for idempotent re-runs.
    const result = await this.db.query<ProjectRow>(
      `select * from projects where name = $1 order by created_at asc limit 1`,
      [name],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(): Promise<Project[]> {
    const result = await this.db.query<ProjectRow>(`select * from projects order by created_at asc`);
    return result.rows.map(mapRow);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.query(`delete from projects where id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
