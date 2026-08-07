/**
 * Test-only fake for the {@link Queryable} port. Records every call
 * (SQL text + params) and replays queued canned responses, so repository
 * tests can run without a real Postgres connection.
 */

import type { Queryable } from "@/db/pool";

export interface RecordedCall {
  text: string;
  params: readonly unknown[] | undefined;
}

export interface FakeResponse<R> {
  rows: R[];
  rowCount?: number | null;
}

export interface FakeDb {
  db: Queryable;
  calls: RecordedCall[];
}

/** Normalizes SQL whitespace so assertions aren't brittle to formatting. */
export function normalizeSql(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Builds a fake {@link Queryable} that returns `responses` in order, one per
 * call to `.query`. Calls beyond the queued responses return an empty result.
 */
export function fakeDb(responses: Array<FakeResponse<unknown>>): FakeDb {
  const calls: RecordedCall[] = [];
  let i = 0;
  const db: Queryable = {
    query: async (text: string, params?: readonly unknown[]) => {
      calls.push({ text, params });
      const response = responses[i++] ?? { rows: [], rowCount: 0 };
      return {
        rows: response.rows,
        rowCount: response.rowCount ?? response.rows.length,
      } as never;
    },
  };
  return { db, calls };
}
