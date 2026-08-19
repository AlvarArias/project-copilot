/**
 * CI database connectivity check.
 *
 * Inserts one row into `_health_check`, then deletes it — proving that
 * GitHub Actions can reach the Supabase/Postgres database configured in
 * `DATABASE_URL`. The `_health_check` table exists only for this purpose
 * (see migrations/0002_health_check.sql); no application code reads or
 * writes it, and this script never touches any other table.
 *
 * Run with: `npm run db:health-check` (DATABASE_URL must already be set in
 * the environment — the db-health-check workflow injects it from the
 * DATABASE_URL repo secret; locally, export it or run via
 * `node --env-file=.env --import tsx src/scripts/db-health-check.ts`).
 */

import { getPool, closePool } from "@/db/pool";

async function main(): Promise<void> {
  const pool = getPool();

  console.log("Insertando registro de prueba en _health_check...");
  const inserted = await pool.query<{ id: string; checked_at: string }>(
    `insert into _health_check (source) values ($1) returning id, checked_at`,
    ["github-actions"],
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new Error("El INSERT no devolvió ninguna fila.");
  }
  console.log(`Registro creado: id=${row.id} checked_at=${row.checked_at}`);

  console.log("Borrando el registro de prueba...");
  const deleted = await pool.query(`delete from _health_check where id = $1`, [
    row.id,
  ]);
  if (deleted.rowCount !== 1) {
    throw new Error(
      `Se esperaba borrar 1 fila, se borraron ${deleted.rowCount}.`,
    );
  }
  console.log(`Registro id=${row.id} borrado correctamente.`);
  console.log("✅ Conexión a la base de datos verificada (INSERT + DELETE).");
}

main()
  .catch((error: unknown) => {
    console.error("❌ Falló el chequeo de conexión a la base de datos:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
