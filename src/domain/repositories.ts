/**
 * Repository interfaces (ports) for the domain entities in `./types`.
 *
 * These are implemented by the `pg`-backed adapters in `src/repositories`
 * and consumed by the F3 agent tools (`create_task`, `update_task`,
 * `delete_task`, `list_tasks`, `detect_conflicts`, `search_documents`).
 * Depending on interfaces here — rather than the concrete adapters — keeps
 * the domain and agent layers testable without a real database.
 */

import type {
  ChunkSearchResult,
  Document,
  DocumentChunk,
  DocumentStatus,
  Message,
  NewChunkInput,
  NewDocumentInput,
  NewMessageInput,
  NewTaskInput,
  Project,
  Task,
  TaskDependency,
  TaskPatch,
} from "./types";

/** Persistence for {@link Project}. */
export interface ProjectRepository {
  create(input: { name: string }): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  findByName(name: string): Promise<Project | null>;
  list(): Promise<Project[]>;
  delete(id: string): Promise<boolean>;
}

/** Persistence for {@link Task}. */
export interface TaskRepository {
  create(input: NewTaskInput): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task | null>;
  delete(id: string): Promise<boolean>;
  findById(id: string): Promise<Task | null>;
  listByProject(projectId: string): Promise<Task[]>;
}

/** Persistence for {@link TaskDependency}. */
export interface TaskDependencyRepository {
  add(taskId: string, dependsOnId: string): Promise<TaskDependency>;
  remove(taskId: string, dependsOnId: string): Promise<boolean>;
  listByProject(projectId: string): Promise<TaskDependency[]>;
  /** Edges where `taskId` is the dependent (what this task depends on). */
  listForTask(taskId: string): Promise<TaskDependency[]>;
  /** Edges where `taskId` is depended upon (what breaks if it's deleted). */
  listDependents(taskId: string): Promise<TaskDependency[]>;
}

/** Persistence for {@link Document}. */
export interface DocumentRepository {
  create(input: NewDocumentInput): Promise<Document>;
  updateStatus(id: string, status: DocumentStatus): Promise<Document | null>;
  findById(id: string): Promise<Document | null>;
  listByProject(projectId: string): Promise<Document[]>;
  delete(id: string): Promise<boolean>;
}

/** Persistence for {@link DocumentChunk} and similarity search. */
export interface DocumentChunkRepository {
  insertMany(chunks: NewChunkInput[]): Promise<DocumentChunk[]>;
  searchSimilar(projectId: string, embedding: number[], topK: number): Promise<ChunkSearchResult[]>;
  deleteByDocument(documentId: string): Promise<number>;
}

/** Persistence for {@link Message}. */
export interface MessageRepository {
  create(input: NewMessageInput): Promise<Message>;
  listByProject(projectId: string, limit?: number): Promise<Message[]>;
}

/** The full set of repositories the domain and agent tools depend on. */
export interface Repositories {
  projects: ProjectRepository;
  tasks: TaskRepository;
  taskDependencies: TaskDependencyRepository;
  documents: DocumentRepository;
  documentChunks: DocumentChunkRepository;
  messages: MessageRepository;
}
