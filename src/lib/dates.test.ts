import { describe, expect, it } from "vitest";

import { isIsoDate, normalizeDate } from "@/lib/dates";

describe("isIsoDate", () => {
  it("accepts a real calendar date in YYYY-MM-DD form", () => {
    expect(isIsoDate("2025-01-06")).toBe(true);
  });

  it("rejects a date that doesn't exist on the calendar", () => {
    expect(isIsoDate("2025-02-30")).toBe(false);
  });

  it("rejects a string that isn't in YYYY-MM-DD shape", () => {
    expect(isIsoDate("01/06/2025")).toBe(false);
  });
});

describe("normalizeDate", () => {
  it("passes through an already-valid YYYY-MM-DD date", () => {
    expect(normalizeDate("2025-01-06")).toBe("2025-01-06");
  });

  it("converts M/D/YY (Google Sheets default) to YYYY-MM-DD", () => {
    expect(normalizeDate("1/6/25")).toBe("2025-01-06");
  });

  it("converts M/D/YYYY to YYYY-MM-DD", () => {
    expect(normalizeDate("1/6/2025")).toBe("2025-01-06");
  });

  it("pads single-digit month/day for slash format", () => {
    expect(normalizeDate("3/9/2025")).toBe("2025-03-09");
  });

  it("converts DD-MM-YYYY (dashes) to YYYY-MM-DD", () => {
    expect(normalizeDate("01-06-2025")).toBe("2025-06-01");
  });

  it("takes the date portion of an ISO datetime, verbatim", () => {
    expect(normalizeDate("2025-01-06T00:00:00Z")).toBe("2025-01-06");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(normalizeDate("  2025-01-06  ")).toBe("2025-01-06");
  });

  it("returns null for an empty string", () => {
    expect(normalizeDate("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(normalizeDate("   ")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizeDate(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeDate(undefined)).toBeNull();
  });

  it("returns null for a non-string input", () => {
    expect(normalizeDate(20250106)).toBeNull();
  });

  it("returns null for a garbage string with no separators", () => {
    expect(normalizeDate("garbage")).toBeNull();
  });

  // Legacy bug fix (a) — see reference-ui/gantt.test.js "BUG: native Date
  // fallback can shift the date by one day": the legacy last-resort
  // `new Date(str)` fallback parsed as LOCAL time then converted via
  // `.toISOString()`, silently shifting date-only strings back a day in
  // timezones ahead of UTC. This port re-derives the calendar date from the
  // parsed local Y/M/D components before converting to UTC, so the result is
  // correct regardless of the machine's timezone.
  it("does not shift the date by a day in the native-Date fallback (legacy bug, fixed)", () => {
    expect(normalizeDate("January 6, 2025")).toBe("2025-01-06");
  });

  // Legacy bug fix (b) — see reference-ui/gantt.test.js "BUG: a non-numeric
  // 3-part dash string...": the legacy DD-MM-YYYY branch only checked
  // `dashParts.length === 3 && dashParts[2].length === 4` without validating
  // that the parts were numeric, so "not-a-date" slipped through and produced
  // the corrupt string "date-0a-not". This port validates every candidate
  // with `isIsoDate` before accepting it, so the malformed lookalike falls
  // through every strategy and correctly returns null.
  it("returns null for a non-numeric 3-part dash string instead of producing garbage (legacy bug, fixed)", () => {
    expect(normalizeDate("not-a-date")).toBeNull();
  });
});
