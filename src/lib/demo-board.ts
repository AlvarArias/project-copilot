/**
 * Server-only read of a project and its tasks, defaulting to the single
 * shared demo project (PLAN.md decision E1 — no auth, one project).
 *
 * `src/app/page.tsx` and `src/app/api/tasks/route.ts` both call
 * {@link getDemoBoard} so the route isn't a parallel code path to what the
 * page renders server-side.
 *
 * Touches the connection pool via `createRepositories()` — do not import
 * this from a client component.
 */

import { DEMO_PROJECT_NAME } from "@/domain/demo-project";
import { createRepositories } from "@/repositories";
import type { Repositories } from "@/domain/repositories";
import type { Project, Task } from "@/domain/types";

/** A project and its tasks, ready to render. */
export interface DemoBoard {
  project: Project;
  tasks: Task[];
}

/**
 * Loads `projectId`'s tasks, or the shared demo project's when `projectId`
 * is omitted. Returns `null` when the target project doesn't exist yet
 * (most commonly: `npm run seed` hasn't been run).
 *
 * `repos` defaults to the real `pg`-backed bundle but can be swapped for a
 * fake in tests, matching the injection pattern `createRepositories` itself
 * uses for `db` (`src/repositories/index.ts`).
 */
export async function getDemoBoard(
  projectId?: string,
  repos: Repositories = createRepositories(),
): Promise<DemoBoard | null> {
  const project = projectId
    ? await repos.projects.findById(projectId)
    : await repos.projects.findByName(DEMO_PROJECT_NAME);
  if (!project) return null;

  const tasks = await repos.tasks.listByProject(project.id);
  return { project, tasks };
}
