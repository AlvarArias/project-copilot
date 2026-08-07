import { describe, expect, it } from "vitest";

import { formatProjectTitle } from "@/lib/format";

describe("formatProjectTitle", () => {
  it("trims surrounding whitespace", () => {
    expect(formatProjectTitle("  Project Copilot  ")).toBe("Project Copilot");
  });

  it("collapses internal whitespace", () => {
    expect(formatProjectTitle("Project    Copilot")).toBe("Project Copilot");
  });
});
