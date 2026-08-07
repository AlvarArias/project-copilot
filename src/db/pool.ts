/**
 * Postgres connection pool.
 *
 * Repositories depend on the narrow {@link Queryable} interface, not on
 * `pg`'s `Pool` directly — this keeps them testable with a fake/in-memory
 * implementation and decouples the domain from the driver.
 */

import { Pool, types, type QueryResult, type QueryResultRow } from "pg";

// By default `pg` parses date/time columns into JS `Date` objects, which
// drift across timezones once rendered locally and break the `string`
// contract the domain types declare. We keep the raw text instead:
//   - OID 1082 = `date`  -> `YYYY-MM-DD` (Gantt + agent tools expect this).
//   - OID 1114 = `timestamp`, 1184 = `timestamptz` -> ISO-8601 text, so
//     `createdAt`/`updatedAt`/`uploadedAt` stay strings end-to-end.
types.setTypeParser(1082, (value: string) => value);
types.setTypeParser(1114, (value: string) => value);
types.setTypeParser(1184, (value: string) => value);

/**
 * The subset of `pg`'s query API that repositories need. A `Pool` (or a
 * `PoolClient`) satisfies this interface, but so can a fake in tests.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

let pool: Pool | null = null;

/** Returns the lazily-created singleton connection pool. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/** Ends the singleton pool, if one was created, and clears it. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
