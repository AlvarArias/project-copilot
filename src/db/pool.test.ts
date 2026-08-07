import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPool } from "@/db/pool";

describe("getPool", () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("throws when DATABASE_URL is not set", () => {
    // The singleton `pool` in the module is only created on a successful
    // call, so as long as no earlier test in this process has provided a
    // valid DATABASE_URL, this exercises the guard directly.
    expect(() => getPool()).toThrow("DATABASE_URL is not set");
  });
});
