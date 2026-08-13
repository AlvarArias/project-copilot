/**
 * Minimal ambient types for `frappe-gantt@0.6.1`, which ships no `.d.ts`
 * files. Declares only the constructor input and the instance members
 * `GanttView` actually calls (`refresh`, `render`, `gantt_end`).
 *
 * `view_mode` / `date_format` / `bar_height` / `gantt_end` etc. are the
 * library's own snake_case API, not our naming convention.
 */
declare module "frappe-gantt" {
  export interface GanttTaskInput {
    id: string;
    name: string;
    start: string;
    end: string;
    progress: number;
    custom_class?: string;
  }

  export interface GanttOptions {
    view_mode?: "Quarter Day" | "Half Day" | "Day" | "Week" | "Month" | "Year";
    date_format?: string;
    bar_height?: number;
    padding?: number;
    scroll_to?: "today" | "start" | "end";
  }

  export default class Gantt {
    constructor(wrapper: HTMLElement, tasks: GanttTaskInput[], options?: GanttOptions);
    /** Re-renders in place with a new task list — does not remount the SVG. */
    refresh(tasks: GanttTaskInput[]): void;
    /** Re-renders using the current `tasks`/options/`gantt_end`. */
    render(): void;
    /** The computed right edge of the chart's date range; see the F2 workaround for its v0.6.1 bug. */
    gantt_end: Date;
  }
}
