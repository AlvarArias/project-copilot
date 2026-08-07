/**
 * Domain types for Project Copilot.
 *
 * Pure TypeScript — no dependency on `pg` or any other driver. Field names
 * are camelCase; the `src/repositories` adapters are responsible for
 * mapping to/from the snake_case columns in `migrations/0001_init.sql`.
 */

/** Allowed values for {@link Task.status}. */
export const TASK_STATUSES = ["planned", "in_progress", "done", "blocked"] as const;

/** A task's lifecycle state. */
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A document's ingestion state. */
export type DocumentStatus = "processing" | "ready" | "error";

/** Who authored a chat message. */
export type MessageRole = "user" | "assistant";

/** A container for tasks, documents, and conversation history. */
export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

/** A single Gantt entry belonging to a project. */
export interface Task {
  id: string;
  projectId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

/** Records that `taskId` cannot start/finish before `dependsOnId`. */
export interface TaskDependency {
  taskId: string;
  dependsOnId: string;
}

/** A file uploaded to a project for RAG ingestion. */
export interface Document {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string | null;
  uploadedAt: string;
  status: DocumentStatus;
}

/**
 * A chunk of extracted document text, ready for semantic search.
 *
 * The 1536-dimension embedding vector is intentionally omitted from this
 * read model — it's large and no consumer needs it back once it has been
 * stored; retrieval only needs the similarity score computed in SQL.
 */
export interface DocumentChunk {
  id: string;
  documentId: string;
  projectId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
}

/** A {@link DocumentChunk} returned by a similarity search. */
export interface ChunkSearchResult extends DocumentChunk {
  filename: string;
  /** 1 - cosine distance; 1.0 is an identical vector. */
  similarity: number;
}

/** A single turn in a project's chat history. */
export interface Message {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string | null;
  toolCalls: unknown | null;
  createdAt: string;
}

/** Input for creating a {@link Task}. */
export interface NewTaskInput {
  projectId: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number;
  status?: TaskStatus;
}

/** Partial update applied to an existing {@link Task}. */
export interface TaskPatch {
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number;
  status?: TaskStatus;
}

/** Input for creating a {@link Document}. */
export interface NewDocumentInput {
  projectId: string;
  filename: string;
  mimeType?: string | null;
  status?: DocumentStatus;
}

/** Input for inserting a {@link DocumentChunk} together with its embedding. */
export interface NewChunkInput {
  documentId: string;
  projectId: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number | null;
  /** OpenAI `text-embedding-3-small` vector; must have length 1536. */
  embedding: number[];
}

/** Input for creating a {@link Message}. */
export interface NewMessageInput {
  projectId: string;
  role: MessageRole;
  content?: string | null;
  toolCalls?: unknown | null;
}
