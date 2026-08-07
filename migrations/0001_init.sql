-- 0001_init.sql
-- Project Copilot — initial schema.
--
-- Runs as-is against either:
--   - Supabase's SQL editor (Project -> SQL Editor -> New query), or
--   - a local Postgres via psql, e.g.:
--       psql "$DATABASE_URL" -f migrations/0001_init.sql
--
-- Idempotent: safe to re-run (uses IF NOT EXISTS throughout).
-- No ORM/migrator here by design — plain SQL for F0. F1 adds the `pg`
-- driver and repositories on top of this schema (see PLAN.md).

-- pgcrypto:  gen_random_uuid() for primary keys.
-- vector:    pgvector, for document_chunks.embedding.
create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name       text not null,
  start_date date,
  end_date   date,
  progress   int not null default 0 check (progress between 0 and 100),
  status     text not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_project_id_idx on tasks (project_id);

-- ---------------------------------------------------------------------------
-- task_dependencies (task_id depends on depends_on_id)
-- ---------------------------------------------------------------------------
create table if not exists task_dependencies (
  task_id       uuid not null references tasks (id) on delete cascade,
  depends_on_id uuid not null references tasks (id) on delete cascade,
  primary key (task_id, depends_on_id)
);

create index if not exists task_dependencies_depends_on_id_idx
  on task_dependencies (depends_on_id);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  filename    text not null,
  mime_type   text,
  uploaded_at timestamptz not null default now(),
  status      text not null default 'processing'
    check (status in ('processing', 'ready', 'error'))
);

create index if not exists documents_project_id_idx on documents (project_id);

-- ---------------------------------------------------------------------------
-- document_chunks
-- OpenAI text-embedding-3-small -> vector(1536).
-- HNSW is used over IVFFlat so the index can be created empty, without first
-- needing rows to train on (IVFFlat requires representative data upfront).
-- ---------------------------------------------------------------------------
create table if not exists document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  project_id  uuid not null references projects (id) on delete cascade,
  chunk_index int,
  content     text,
  token_count int,
  embedding   vector(1536)
);

create index if not exists document_chunks_project_id_idx
  on document_chunks (project_id);

create index if not exists document_chunks_document_id_idx
  on document_chunks (document_id);

create index if not exists document_chunks_embedding_hnsw_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- messages (chat history)
-- ---------------------------------------------------------------------------
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  role       text,
  content    text,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_project_id_idx on messages (project_id);
