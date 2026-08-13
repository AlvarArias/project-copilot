/**
 * Seeds a demo project for the Gantt / agent demo.
 *
 * Idempotent: re-running deletes any existing project with the same name
 * (cascading to its tasks and dependencies) before recreating it.
 *
 * Run with: `npm run seed` (loads `.env` via Node's `--env-file` flag).
 */

import { closePool } from "@/db/pool";
import { createRepositories } from "@/repositories";
import { DEMO_PROJECT_NAME } from "@/domain/demo-project";
import type { TaskStatus } from "@/domain/types";

const PROJECT_NAME = DEMO_PROJECT_NAME;

interface TaskSeed {
  key: string;
  name: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: TaskStatus;
  dependsOn: string[];
}

const TASKS: TaskSeed[] = [
  {
    key: "discovery",
    name: "Investigación y descubrimiento",
    startDate: "2026-09-01",
    endDate: "2026-09-11",
    progress: 100,
    status: "done",
    dependsOn: [],
  },
  {
    key: "prd",
    name: "Especificación de producto (PRD)",
    startDate: "2026-09-14",
    endDate: "2026-09-22",
    progress: 100,
    status: "done",
    dependsOn: ["discovery"],
  },
  {
    key: "ux-ui",
    name: "Diseño UX/UI",
    startDate: "2026-09-23",
    endDate: "2026-10-07",
    progress: 60,
    status: "in_progress",
    dependsOn: ["prd"],
  },
  {
    key: "backend-arch",
    name: "Arquitectura backend",
    startDate: "2026-09-23",
    endDate: "2026-10-02",
    progress: 40,
    status: "in_progress",
    dependsOn: ["prd"],
  },
  {
    key: "backend-dev",
    name: "Desarrollo backend / API",
    startDate: "2026-10-06",
    endDate: "2026-10-24",
    progress: 10,
    status: "in_progress",
    dependsOn: ["backend-arch"],
  },
  {
    key: "frontend-dev",
    name: "Desarrollo frontend móvil",
    startDate: "2026-10-08",
    endDate: "2026-10-29",
    progress: 0,
    status: "planned",
    dependsOn: ["ux-ui", "backend-dev"],
  },
  {
    key: "qa",
    name: "Integración y QA",
    startDate: "2026-10-30",
    endDate: "2026-11-10",
    progress: 0,
    status: "planned",
    dependsOn: ["frontend-dev"],
  },
  {
    key: "beta",
    name: "Beta cerrada",
    startDate: "2026-11-11",
    endDate: "2026-11-18",
    progress: 0,
    status: "planned",
    dependsOn: ["qa"],
  },
  {
    key: "launch",
    name: "Lanzamiento en tiendas",
    startDate: "2026-11-19",
    endDate: "2026-11-25",
    progress: 0,
    status: "planned",
    dependsOn: ["beta"],
  },
];

async function main(): Promise<void> {
  const repos = createRepositories();

  const existing = await repos.projects.findByName(PROJECT_NAME);
  if (existing) {
    await repos.projects.delete(existing.id);
  }

  const project = await repos.projects.create({ name: PROJECT_NAME });

  const taskIdByKey = new Map<string, string>();
  for (const seed of TASKS) {
    const task = await repos.tasks.create({
      projectId: project.id,
      name: seed.name,
      startDate: seed.startDate,
      endDate: seed.endDate,
      progress: seed.progress,
      status: seed.status,
    });
    taskIdByKey.set(seed.key, task.id);
  }

  let dependencyCount = 0;
  for (const seed of TASKS) {
    const taskId = taskIdByKey.get(seed.key);
    if (!taskId) continue;
    for (const dependsOnKey of seed.dependsOn) {
      const dependsOnId = taskIdByKey.get(dependsOnKey);
      if (!dependsOnId) continue;
      await repos.taskDependencies.add(taskId, dependsOnId);
      dependencyCount += 1;
    }
  }

  console.log(
    `Seeded project "${project.name}" (${project.id}) with ${taskIdByKey.size} tasks and ${dependencyCount} dependencies.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
