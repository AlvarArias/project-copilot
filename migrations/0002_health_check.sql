-- 0002_health_check.sql
-- Minimal table used only by the CI "DB Health Check" GitHub Actions
-- workflow (.github/workflows/db-health-check.yml, via
-- src/scripts/db-health-check.ts): it inserts one row, then deletes it in
-- the same run, to prove CI can reach the Supabase/Postgres database.
-- Not read or written by any application code.
--
-- Run it the same way as 0001_init.sql (Supabase SQL Editor, or
-- `psql "$DATABASE_URL" -f migrations/0002_health_check.sql`).
-- Idempotent: safe to re-run.
create table if not exists _health_check (
  id         uuid primary key default gen_random_uuid(),
  source     text not null default 'github-actions',
  checked_at timestamptz not null default now()
);
