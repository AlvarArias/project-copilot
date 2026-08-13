import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "@/domain/agent/prompt";

describe("buildSystemPrompt", () => {
  it("includes the project name and today's date", () => {
    const prompt = buildSystemPrompt({ projectName: "Lanzamiento Q3", today: "2026-08-20" });

    expect(prompt).toContain("Lanzamiento Q3");
    expect(prompt).toContain("2026-08-20");
  });

  it("mentions all four F3 tool names", () => {
    const prompt = buildSystemPrompt({ projectName: "Lanzamiento Q3", today: "2026-08-20" });

    expect(prompt).toContain("create_task");
    expect(prompt).toContain("update_task");
    expect(prompt).toContain("delete_task");
    expect(prompt).toContain("list_tasks");
  });
});
