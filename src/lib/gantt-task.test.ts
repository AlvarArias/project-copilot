import { describe, expect, it } from "vitest";

import { daysBetween, formatShortDate, toGanttTasks } from "@/lib/gantt-task";
import type { Task } from "@/domain/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "project-1",
    name: "Design review",
    startDate: "2026-09-01",
    endDate: "2026-09-05",
    progress: 50,
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("toGanttTasks", () => {
  it("maps id, name, dates, and progress straight through, tagging every bar as bar-default", () => {
    const task = makeTask();

    const { tasks, skipped } = toGanttTasks([task]);

    expect(tasks).toEqual([
      {
        id: "task-1",
        name: "Design review",
        start: "2026-09-01",
        end: "2026-09-05",
        progress: 50,
        custom_class: "bar-default",
      },
    ]);
    expect(skipped).toEqual([]);
  });

  it("skips a task with a null start date and records its name", () => {
    const task = makeTask({ id: "task-2", name: "Undated kickoff", startDate: null });

    const { tasks, skipped } = toGanttTasks([task]);

    expect(tasks).toEqual([]);
    expect(skipped).toEqual(["Undated kickoff"]);
  });

  it("skips a task with a null end date and records its name", () => {
    const task = makeTask({ id: "task-3", name: "Open-ended research", endDate: null });

    const { tasks, skipped } = toGanttTasks([task]);

    expect(tasks).toEqual([]);
    expect(skipped).toEqual(["Open-ended research"]);
  });

  it("skips a task missing both dates and records its name once", () => {
    const task = makeTask({ id: "task-4", name: "Backlog idea", startDate: null, endDate: null });

    const { tasks, skipped } = toGanttTasks([task]);

    expect(tasks).toEqual([]);
    expect(skipped).toEqual(["Backlog idea"]);
  });

  it("preserves input order and only skips the tasks that lack dates", () => {
    const tasks = [
      makeTask({ id: "task-a", name: "A" }),
      makeTask({ id: "task-b", name: "B", startDate: null }),
      makeTask({ id: "task-c", name: "C" }),
    ];

    const { tasks: mapped, skipped } = toGanttTasks(tasks);

    expect(mapped.map((t) => t.id)).toEqual(["task-a", "task-c"]);
    expect(skipped).toEqual(["B"]);
  });

  it("returns empty tasks and skipped arrays for empty input", () => {
    expect(toGanttTasks([])).toEqual({ tasks: [], skipped: [] });
  });
});

describe("daysBetween", () => {
  it("counts a same-day span as 0 days", () => {
    expect(daysBetween("2026-09-01", "2026-09-01")).toBe(0);
  });

  it("counts a multi-day span exclusively, matching Math.round((end - start) / 86_400_000)", () => {
    expect(daysBetween("2026-09-01", "2026-09-05")).toBe(4);
  });

  it("rounds fractional day differences (DST-affected ranges) to the nearest whole day", () => {
    // 2026-03-08 is the US DST spring-forward date; a naive UTC diff still
    // yields a clean whole number here since both endpoints are UTC midnight.
    expect(daysBetween("2026-03-01", "2026-03-08")).toBe(7);
  });
});

describe("formatShortDate", () => {
  it("formats a mid-month date as '<Mon> <day>'", () => {
    expect(formatShortDate("2026-09-14")).toBe("Sep 14");
  });

  it("does not zero-pad the day", () => {
    expect(formatShortDate("2026-01-05")).toBe("Jan 5");
  });

  it("maps every month index correctly", () => {
    expect(formatShortDate("2026-01-01")).toBe("Jan 1");
    expect(formatShortDate("2026-12-25")).toBe("Dec 25");
  });

  it("regression: does not shift to the previous day in negative-offset timezones", () => {
    // new Date('2026-09-01') is UTC midnight; formatting it with a
    // timezone-aware method (e.g. toLocaleDateString without an explicit
    // UTC timezone) would render "Aug 31" west of UTC. Splitting the
    // string instead must always read the calendar date as written.
    expect(formatShortDate("2026-09-01")).toBe("Sep 1");
  });
});
