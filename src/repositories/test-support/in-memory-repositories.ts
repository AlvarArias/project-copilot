/**
 * Real (in-process, no SQL) implementation of the full {@link Repositories}
 * bundle, for the agent-loop integration test. `tasks` and `messages` have
 * genuine create/update/delete/list semantics with generated uuids and
 * timestamps, so a test can assert a task was actually persisted after
 * `runAgent` executes a tool. The rest of the bundle (`projects`,
 * `taskDependencies`, `documents`, `documentChunks`) is out of scope for F3
 * — those are minimal stubs that throw "not implemented"; nothing in the
 * F3 agent/tools path calls them.
 */

import { randomUUID } from "node:crypto";

import type {
  DocumentChunkRepository,
  DocumentRepository,
  MessageRepository,
  ProjectRepository,
  Repositories,
  TaskDependencyRepository,
  TaskRepository,
} from "@/domain/repositories";
import type {
  ChunkSearchResult,
  Document,
  DocumentChunk,
  Message,
  NewMessageInput,
  NewTaskInput,
  Project,
  Task,
  TaskDependency,
  TaskPatch,
} from "@/domain/types";

function notImplemented(method: string): never {
  throw new Error(`${method} is not implemented in createInMemoryRepositories() — only tasks/messages are real.`);
}

/** Real in-memory {@link TaskRepository}, keyed by generated uuid. */
export class InMemoryTaskRepository implements TaskRepository {
  private readonly rows = new Map<string, Task>();

  async create(input: NewTaskInput): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      progress: input.progress ?? 0,
      status: input.status ?? "planned",
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(task.id, task);
    return task;
  }

  async update(id: string, patch: TaskPatch): Promise<Task | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: Task = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async findById(id: string): Promise<Task | null> {
    return this.rows.get(id) ?? null;
  }

  async listByProject(projectId: string): Promise<Task[]> {
    return [...this.rows.values()]
      .filter((task) => task.projectId === projectId)
      .sort(
        (a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.createdAt.localeCompare(b.createdAt),
      );
  }

  /** Snapshot of every row across all projects, for direct test assertions. */
  all(): Task[] {
    return [...this.rows.values()];
  }
}

/** Real in-memory {@link MessageRepository}, preserving insertion (= chronological) order. */
export class InMemoryMessageRepository implements MessageRepository {
  private readonly rows: Message[] = [];

  async create(input: NewMessageInput): Promise<Message> {
    const message: Message = {
      id: randomUUID(),
      projectId: input.projectId,
      role: input.role,
      content: input.content ?? null,
      toolCalls: input.toolCalls ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.push(message);
    return message;
  }

  async listByProject(projectId: string, limit?: number): Promise<Message[]> {
    const filtered = this.rows.filter((message) => message.projectId === projectId);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  /** Snapshot of every row across all projects, for direct test assertions. */
  all(): Message[] {
    return [...this.rows];
  }
}

// Unused interface parameters are omitted below rather than underscore-prefixed:
// TS structurally allows implementing a method with fewer parameters than its
// interface declares, and it keeps these stubs free of unused-var lint noise.
class StubProjectRepository implements ProjectRepository {
  async create(): Promise<Project> {
    notImplemented("ProjectRepository.create");
  }
  async findById(): Promise<Project | null> {
    notImplemented("ProjectRepository.findById");
  }
  async findByName(): Promise<Project | null> {
    notImplemented("ProjectRepository.findByName");
  }
  async list(): Promise<Project[]> {
    notImplemented("ProjectRepository.list");
  }
  async delete(): Promise<boolean> {
    notImplemented("ProjectRepository.delete");
  }
}

class StubTaskDependencyRepository implements TaskDependencyRepository {
  async add(): Promise<TaskDependency> {
    notImplemented("TaskDependencyRepository.add");
  }
  async remove(): Promise<boolean> {
    notImplemented("TaskDependencyRepository.remove");
  }
  async listByProject(): Promise<TaskDependency[]> {
    notImplemented("TaskDependencyRepository.listByProject");
  }
  async listForTask(): Promise<TaskDependency[]> {
    notImplemented("TaskDependencyRepository.listForTask");
  }
  async listDependents(): Promise<TaskDependency[]> {
    notImplemented("TaskDependencyRepository.listDependents");
  }
}

class StubDocumentRepository implements DocumentRepository {
  async create(): Promise<Document> {
    notImplemented("DocumentRepository.create");
  }
  async updateStatus(): Promise<Document | null> {
    notImplemented("DocumentRepository.updateStatus");
  }
  async findById(): Promise<Document | null> {
    notImplemented("DocumentRepository.findById");
  }
  async listByProject(): Promise<Document[]> {
    notImplemented("DocumentRepository.listByProject");
  }
  async delete(): Promise<boolean> {
    notImplemented("DocumentRepository.delete");
  }
}

class StubDocumentChunkRepository implements DocumentChunkRepository {
  async insertMany(): Promise<DocumentChunk[]> {
    notImplemented("DocumentChunkRepository.insertMany");
  }
  async searchSimilar(): Promise<ChunkSearchResult[]> {
    notImplemented("DocumentChunkRepository.searchSimilar");
  }
  async deleteByDocument(): Promise<number> {
    notImplemented("DocumentChunkRepository.deleteByDocument");
  }
}

export interface InMemoryRepositories extends Repositories {
  tasks: InMemoryTaskRepository;
  messages: InMemoryMessageRepository;
}

/** Builds a full {@link Repositories} bundle with real task/message behavior and no database. */
export function createInMemoryRepositories(): InMemoryRepositories {
  return {
    projects: new StubProjectRepository(),
    tasks: new InMemoryTaskRepository(),
    taskDependencies: new StubTaskDependencyRepository(),
    documents: new StubDocumentRepository(),
    documentChunks: new StubDocumentChunkRepository(),
    messages: new InMemoryMessageRepository(),
  };
}
