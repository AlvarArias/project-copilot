/**
 * Wires the `pg`-backed repository adapters into a single {@link Repositories}
 * bundle, defaulting to the shared connection pool.
 */

import { getPool, type Queryable } from "@/db/pool";
import type { Repositories } from "@/domain/repositories";

import { PgDocumentChunkRepository } from "./document-chunk-repository";
import { PgDocumentRepository } from "./document-repository";
import { PgMessageRepository } from "./message-repository";
import { PgProjectRepository } from "./project-repository";
import { PgTaskDependencyRepository } from "./task-dependency-repository";
import { PgTaskRepository } from "./task-repository";

export {
  PgDocumentChunkRepository,
  PgDocumentRepository,
  PgMessageRepository,
  PgProjectRepository,
  PgTaskDependencyRepository,
  PgTaskRepository,
};

/** Builds a full {@link Repositories} bundle backed by `db` (the shared pool by default). */
export function createRepositories(db: Queryable = getPool()): Repositories {
  return {
    projects: new PgProjectRepository(db),
    tasks: new PgTaskRepository(db),
    taskDependencies: new PgTaskDependencyRepository(db),
    documents: new PgDocumentRepository(db),
    documentChunks: new PgDocumentChunkRepository(db),
    messages: new PgMessageRepository(db),
  };
}
