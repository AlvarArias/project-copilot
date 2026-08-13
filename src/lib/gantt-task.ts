/**
 * Pure mapping from domain {@link Task}s to the shape Frappe Gantt expects,
 * plus the left-panel formatting helpers that go with it.
 *
 * No React and no `pg` here — this is the piece unit tests exercise
 * directly. Ported from `reference-ui/gantt.js` (see PLAN.md risk R5).
 */

import type { Task } from "@/domain/types";

/**
 * The task shape Frappe Gantt's constructor and `refresh()` expect.
 *
 * `custom_class` is the library's own snake_case API surface, not our
 * naming convention slipping — every other field here just happens to
 * share a name with our domain.
 */
export interface GanttTask {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  custom_class: string;
}

/** Frappe's only non-highlight bar class; `bar-highlight` is reserved for F4. */
const DEFAULT_BAR_CLASS = "bar-default";

/** Result of {@link toGanttTasks}. */
export interface GanttMapping {
  tasks: GanttTask[];
  /** Names of tasks dropped for missing a start or end date. */
  skipped: string[];
}

/**
 * Maps {@link Task}s to {@link GanttTask}s for Frappe.
 *
 * A task with a null `startDate` or `endDate` can't be drawn, so it's
 * skipped and its name recorded in `skipped` instead of being silently
 * dropped (mirrors `reference-ui/gantt.js:52-68`, which warns about exactly
 * this rather than failing silently).
 *
 * Input order is preserved — `TaskRepository.listByProject` already sorts
 * by start date, so there's nothing to re-sort here.
 */
export function toGanttTasks(tasks: Task[]): GanttMapping {
  const mapped: GanttTask[] = [];
  const skipped: string[] = [];

  for (const task of tasks) {
    if (!task.startDate || !task.endDate) {
      skipped.push(task.name);
      continue;
    }
    mapped.push({
      id: task.id,
      name: task.name,
      start: task.startDate,
      end: task.endDate,
      progress: task.progress,
      custom_class: DEFAULT_BAR_CLASS,
    });
  }

  return { tasks: mapped, skipped };
}

/** Whole days between two `YYYY-MM-DD` dates, matching the reference's `Math.round` behavior. */
export function daysBetween(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a `YYYY-MM-DD` date as e.g. `"Sep 1"` for the left panel.
 *
 * Parses by splitting the string, NOT via `new Date(iso)` — the latter
 * reads a date-only string as UTC midnight, which then renders as the
 * previous day once formatted in a negative-offset timezone (PLAN risk R5).
 * `reference-ui/gantt.js:103-107` already avoids this; this port preserves it.
 */
export function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${Number(day)}`;
}
