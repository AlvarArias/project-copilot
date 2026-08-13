"use client";

import Gantt from "frappe-gantt";
import "frappe-gantt/dist/frappe-gantt.css";
import { useEffect, useMemo, useRef, useState } from "react";

import { daysBetween, formatShortDate, toGanttTasks, type GanttTask } from "@/lib/gantt-task";
import type { Project, Task } from "@/domain/types";

import "./GanttView.css";

const GANTT_OPTIONS = {
  view_mode: "Week",
  date_format: "YYYY-MM-DD",
  bar_height: 28,
  padding: 18,
  scroll_to: "today",
} as const;

/**
 * Frappe Gantt v0.6.1 sometimes miscalculates `gantt_end` when the tasks
 * span multiple years, truncating the chart before the last bar. Override
 * it with the true max end date and force a re-render.
 * Ported from `reference-ui/gantt.js:81-90`.
 */
function fixGanttEnd(instance: Gantt, tasks: GanttTask[]): void {
  const trueMaxEnd = tasks.reduce(
    (max, task) => (new Date(task.end) > max ? new Date(task.end) : max),
    new Date(0),
  );
  if (instance.gantt_end < trueMaxEnd) {
    instance.gantt_end = trueMaxEnd;
    instance.render();
  }
}

export interface GanttViewProps {
  project: Project;
  tasks: Task[];
}

/**
 * Read-only Gantt chart (left deliverable panel + Frappe Gantt SVG),
 * adapted from `reference-ui/gantt.js` into a React wrapper.
 *
 * Frappe Gantt is imperative — it owns and mutates its own SVG — so it's
 * constructed exactly once on mount and updated in place via `.refresh()`
 * on later task changes, rather than being remounted on every render.
 */
export default function GanttView({ project, tasks }: GanttViewProps) {
  const { tasks: ganttTasks, skipped } = useMemo(() => toGanttTasks(tasks), [tasks]);

  const chartRef = useRef<HTMLDivElement | null>(null);
  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<Gantt | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  // The element actually constructed into, captured at construction time —
  // not read from `chartRef.current` at teardown time. Reading the ref
  // inside the cleanup itself would be reading a possibly-already-detached
  // value; capturing once at mount (`[]`-effect setup) would be wrong too,
  // since `chartRef.current` is still null on any render where `ganttTasks`
  // starts out empty (see the 0-tasks guard below), which would freeze this
  // at `null` forever and silently break teardown once tasks do arrive.
  const constructedElRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Construct-or-refresh, keyed on the mapped tasks. `instanceRef.current`
  // is the discriminator: null means nothing has been built into `chartEl`
  // yet (true on first mount, and also true right after the unmount-only
  // teardown effect below has run) so we construct; otherwise we refresh
  // the existing instance in place. This effect never tears anything down
  // itself — see the dedicated teardown effect below for why that has to
  // be unmount-only.
  useEffect(() => {
    const chartEl = chartRef.current;
    if (!chartEl || ganttTasks.length === 0) return;

    if (!instanceRef.current) {
      let instance: Gantt;
      try {
        instance = new Gantt(chartEl, ganttTasks, GANTT_OPTIONS);
        fixGanttEnd(instance, ganttTasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to render the Gantt chart.";
        // Surfacing a synchronous throw from this imperative library
        // boundary into React state is exactly what this catch is for.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setError(message);
        return;
      }
      instanceRef.current = instance;
      constructedElRef.current = chartEl;

      const inner = chartEl.querySelector<HTMLElement>(".gantt-container");
      const leftPanel = leftPanelRef.current;
      if (inner && leftPanel) {
        const syncScroll = () => {
          leftPanel.scrollTop = inner.scrollTop;
        };
        inner.addEventListener("scroll", syncScroll);
        scrollCleanupRef.current = () => inner.removeEventListener("scroll", syncScroll);
      }
      return;
    }

    const instance = instanceRef.current;
    try {
      instance.refresh(ganttTasks);
      fixGanttEnd(instance, ganttTasks);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh the Gantt chart.";
      setError(message);
    }
  }, [ganttTasks]);

  // Unmount-only teardown, deliberately kept separate from the effect
  // above: if this cleanup lived on the `[ganttTasks]` effect instead, it
  // would also fire before every *real* task update (React runs an
  // effect's cleanup before re-running it whenever its deps change), which
  // would null `instanceRef` right before the construct/refresh effect
  // reads it and turn every update into a full reconstruction — exactly
  // what `.refresh()` exists to avoid.
  //
  // frappe-gantt ships no `destroy()`/teardown method. Without wiping the
  // container here, React 19 StrictMode's dev-only mount -> cleanup ->
  // mount sequence constructs a second `Gantt` into the still-populated
  // div; per `setup_wrapper` in frappe-gantt's source, that reuses the
  // existing `<svg>` but creates a *new* inner `.gantt-container` nested
  // inside the old one, so a later `querySelector(".gantt-container")`
  // finds the outer, now-empty node and left-panel scroll sync silently
  // breaks. Wipes `constructedElRef.current` (set next to `instanceRef.current`
  // above), not `chartRef.current` — see the comment on `constructedElRef`.
  useEffect(() => {
    return () => {
      scrollCleanupRef.current?.();
      scrollCleanupRef.current = null;
      constructedElRef.current?.replaceChildren();
      constructedElRef.current = null;
      instanceRef.current = null;
    };
  }, []);

  if (error) {
    return (
      <div className="gantt-view">
        <p className="status-state error">{error}</p>
      </div>
    );
  }

  if (ganttTasks.length === 0) {
    return (
      <div className="gantt-view">
        <p className="status-state">
          {tasks.length === 0
            ? `"${project.name}" has no tasks yet.`
            : "None of this project's tasks have both a start and end date yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="gantt-view">
      {skipped.length > 0 && (
        <p className="gantt-skip-note">
          {skipped.length} task{skipped.length === 1 ? "" : "s"} without both a start and end date{" "}
          {skipped.length === 1 ? "is" : "are"} hidden: {skipped.join(", ")}
        </p>
      )}
      <div className="gantt-wrapper">
        <div className="gantt-left-panel" ref={leftPanelRef}>
          <div className="lp-header">
            <span className="lp-name">Deliverable</span>
            <span className="lp-date">Start</span>
            <span className="lp-date">End</span>
            <span className="lp-days">Days</span>
          </div>
          {ganttTasks.map((task) => (
            <div key={task.id} className={`lp-row ${task.custom_class}`}>
              <span className="lp-name" title={task.name}>
                {task.name}
              </span>
              <span className="lp-date">{formatShortDate(task.start)}</span>
              <span className="lp-date">{formatShortDate(task.end)}</span>
              <span className="lp-days">{daysBetween(task.start, task.end)}d</span>
            </div>
          ))}
        </div>
        <div className="gantt-chart-container" ref={chartRef} />
      </div>
    </div>
  );
}
