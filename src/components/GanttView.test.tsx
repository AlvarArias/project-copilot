// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GanttView from "@/components/GanttView";
import type { Project, Task } from "@/domain/types";

vi.mock("frappe-gantt/dist/frappe-gantt.css", () => ({}));
vi.mock("./GanttView.css", () => ({}));

/**
 * Fake for the imperative `frappe-gantt` default export. Real Gantt hits
 * `SVGElement.prototype.getBBox`, which jsdom doesn't implement, so tests
 * must never construct the real thing.
 *
 * Mimics the one piece of real DOM behavior `GanttView` depends on: the
 * real constructor appends a `div.gantt-container` inside the element it's
 * given, which `GanttView` later finds via `querySelector` to wire up
 * left-panel scroll sync.
 */
vi.mock("frappe-gantt", () => {
  class FakeGantt {
    static calls: Array<{ el: HTMLElement; tasks: unknown[]; options: unknown }> = [];
    static instances: FakeGantt[] = [];
    /** Set from a test to make the next construction throw. */
    static shouldThrow: string | null = null;

    el: HTMLElement;
    tasks: unknown[];
    options: unknown;
    gantt_end = new Date(8_640_000_000_000_000);
    refresh = vi.fn((tasks: unknown[]) => {
      this.tasks = tasks;
    });
    render = vi.fn();

    constructor(el: HTMLElement, tasks: unknown[], options: unknown) {
      if (FakeGantt.shouldThrow) {
        throw new Error(FakeGantt.shouldThrow);
      }
      this.el = el;
      this.tasks = tasks;
      this.options = options;
      FakeGantt.calls.push({ el, tasks, options });
      FakeGantt.instances.push(this);

      const container = document.createElement("div");
      container.className = "gantt-container";
      el.appendChild(container);
    }
  }

  return { default: FakeGantt };
});

import Gantt from "frappe-gantt";

interface FakeGanttInstance {
  refresh: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
}

interface FakeGanttStatics {
  calls: Array<{ el: HTMLElement; tasks: unknown[]; options: unknown }>;
  instances: FakeGanttInstance[];
  shouldThrow: string | null;
}

const FakeGantt = Gantt as unknown as FakeGanttStatics;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "MarketPulse",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

beforeEach(() => {
  FakeGantt.calls.length = 0;
  FakeGantt.instances.length = 0;
  FakeGantt.shouldThrow = null;
});

afterEach(() => {
  cleanup();
});

describe("GanttView construction and updates (R4 — no remount on re-render)", () => {
  it("constructs the chart exactly once on mount, with the mapped tasks and the options object", () => {
    const project = makeProject();
    const tasks = [makeTask()];

    render(<GanttView project={project} tasks={tasks} />);

    expect(FakeGantt.calls).toHaveLength(1);
    expect(FakeGantt.calls[0].tasks).toEqual([
      {
        id: "task-1",
        name: "Design review",
        start: "2026-09-01",
        end: "2026-09-05",
        progress: 50,
        custom_class: "bar-default",
      },
    ]);
    expect(FakeGantt.calls[0].options).toMatchObject({
      view_mode: "Week",
      date_format: "YYYY-MM-DD",
      bar_height: 28,
      padding: 18,
      scroll_to: "today",
    });
  });

  it("calls refresh() and does not construct a second instance when tasks change on re-render", () => {
    const project = makeProject();
    const { rerender } = render(<GanttView project={project} tasks={[makeTask()]} />);

    rerender(<GanttView project={project} tasks={[makeTask({ progress: 80 })]} />);

    expect(FakeGantt.calls).toHaveLength(1);
    const instance = FakeGantt.instances[0];
    expect(instance.refresh).toHaveBeenCalledTimes(1);
    expect(instance.refresh).toHaveBeenCalledWith([
      {
        id: "task-1",
        name: "Design review",
        start: "2026-09-01",
        end: "2026-09-05",
        progress: 80,
        custom_class: "bar-default",
      },
    ]);
  });

  it("does not call refresh again when re-rendered with an unchanged tasks prop reference", () => {
    const project = makeProject();
    const tasks = [makeTask()];
    const { rerender } = render(<GanttView project={project} tasks={tasks} />);

    // New project object, same `tasks` array reference: toGanttTasks(tasks)
    // is memoized on [tasks], so the construct/refresh effect (keyed on
    // that memoized result) must not re-run at all.
    rerender(<GanttView project={{ ...project }} tasks={tasks} />);

    const instance = FakeGantt.instances[0];
    expect(instance.refresh).not.toHaveBeenCalled();
  });

  it("regression: constructs the chart once tasks arrive after starting empty", () => {
    // The construct/refresh effect used to run once with `[]` deps; a
    // project that started with zero tasks could then never get a chart at
    // all. Invisible while the seed data is never empty, fatal once F4 lets
    // the agent create the very first task live.
    const project = makeProject();
    const { rerender } = render(<GanttView project={project} tasks={[]} />);

    expect(FakeGantt.calls).toHaveLength(0);

    rerender(<GanttView project={project} tasks={[makeTask()]} />);

    expect(FakeGantt.calls).toHaveLength(1);
  });
});

describe("GanttView teardown (regression: no destroy() in frappe-gantt)", () => {
  it("empties the element it constructed into on unmount", () => {
    const project = makeProject();
    const tasks = [makeTask()];
    const { container, unmount } = render(<GanttView project={project} tasks={tasks} />);

    const chartContainer = container.querySelector(".gantt-chart-container");
    expect(chartContainer?.querySelector(".gantt-container")).not.toBeNull();

    unmount();

    expect(chartContainer?.childElementCount).toBe(0);
  });

  it("regression: StrictMode's dev-only mount->cleanup->mount does not nest a second .gantt-container", () => {
    // Without wiping the constructed element on unmount, StrictMode's
    // double-invoke would construct a second Gantt into the still-populated
    // div; frappe-gantt reuses the existing <svg> but nests a *new*
    // .gantt-container inside the old one, so a later
    // querySelector(".gantt-container") finds the outer, empty node and
    // left-panel scroll sync silently breaks.
    const project = makeProject();
    const tasks = [makeTask()];

    const { container } = render(
      <StrictMode>
        <GanttView project={project} tasks={tasks} />
      </StrictMode>,
    );

    const containers = container.querySelectorAll(".gantt-container");
    expect(containers).toHaveLength(1);
  });
});

describe("GanttView left panel", () => {
  it("renders a header row and one row per drawable task, with its name and day count", () => {
    const project = makeProject();
    const tasks = [
      makeTask({ id: "task-1", name: "Design review", startDate: "2026-09-01", endDate: "2026-09-05" }),
      makeTask({ id: "task-2", name: "Build backend", startDate: "2026-09-06", endDate: "2026-09-12" }),
    ];

    render(<GanttView project={project} tasks={tasks} />);

    expect(screen.getByText("Deliverable")).toBeTruthy();
    expect(screen.getByText("Design review")).toBeTruthy();
    expect(screen.getByText("Build backend")).toBeTruthy();
    expect(screen.getByText("4d")).toBeTruthy();
    expect(screen.getByText("6d")).toBeTruthy();
  });
});

describe("GanttView empty and skipped states", () => {
  it("renders a 'no tasks yet' message when the project has no tasks at all", () => {
    const project = makeProject({ name: "MarketPulse" });

    render(<GanttView project={project} tasks={[]} />);

    expect(screen.getByText('"MarketPulse" has no tasks yet.')).toBeTruthy();
    expect(FakeGantt.calls).toHaveLength(0);
  });

  it("renders a 'no dated tasks' message when every task is missing a start or end date", () => {
    const project = makeProject();

    render(<GanttView project={project} tasks={[makeTask({ startDate: null })]} />);

    expect(
      screen.getByText("None of this project's tasks have both a start and end date yet."),
    ).toBeTruthy();
    expect(FakeGantt.calls).toHaveLength(0);
  });

  it("excludes undated tasks from the chart data and names them in the visible hidden note", () => {
    const project = makeProject();
    const dated = makeTask({ id: "task-1", name: "Design review" });
    const undated = makeTask({ id: "task-2", name: "Undated kickoff", startDate: null });

    render(<GanttView project={project} tasks={[dated, undated]} />);

    expect(FakeGantt.calls[0].tasks).toHaveLength(1);
    expect(screen.getByText(/1 task without both a start and end date is hidden: Undated kickoff/)).toBeTruthy();
  });
});

describe("GanttView error state", () => {
  it("surfaces a constructor error as an error state instead of crashing the render", () => {
    FakeGantt.shouldThrow = "Failed to render the Gantt chart.";
    const project = makeProject();

    render(<GanttView project={project} tasks={[makeTask()]} />);

    expect(screen.getByText("Failed to render the Gantt chart.")).toBeTruthy();
  });
});
