# Setup

Local dev + deployment instructions for the F0 scaffolding. For the product
roadmap and architecture, see [`PLAN.md`](./PLAN.md).

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start Postgres + pgvector locally (alternative to Supabase):

   ```bash
   docker compose up -d
   ```

3. Apply the schema migration:

   ```bash
   psql "postgresql://postgres:postgres@localhost:5432/project_copilot" \
     -f migrations/0001_init.sql
   ```

4. Configure environment variables:

   ```bash
   cp .env.example .env
   # then fill in OPENAI_API_KEY, DATABASE_URL
   ```

5. Run the app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Other scripts

```bash
npm run lint         # eslint (reference-ui/ is excluded, see below)
npm run test         # vitest run
npm run test:watch   # vitest --watch
npm run build         # production build (also used by the Docker image)
npm run seed          # seed the demo project (see Module E in PLAN.md)
```

## `reference-ui/`

`reference-ui/` is a legacy vanilla-JS Gantt component (its own Vitest setup,
own `dom-fixture.js`) kept for reference while it's ported to React/TS. It is
intentionally excluded from this app's `tsconfig.json`, `eslint.config.mjs`,
and `vitest.config.ts` — do not wire it into the Next app's build/lint/test
pipeline until it's actually ported (see Module B in `PLAN.md`).

## Docker

```bash
docker build -t project-copilot .
docker run --env-file .env -p 3000:3000 project-copilot
```

The image is a multi-stage build using Next.js's `output: "standalone"`
mode (`next.config.ts`), producing a minimal `node server.js` runtime image.

## Pending manual steps

These require accounts/credentials that can't be scripted here:

- [ ] **Supabase**: create a project, then enable the `vector` extension
  (Database → Extensions → search "vector" → Enable). Copy the connection
  string (Project Settings → Database → Connection string → URI) into
  `DATABASE_URL` for production.
- [ ] Run `migrations/0001_init.sql` against the Supabase project (SQL
  Editor → New query → paste → Run) — the same file used for local dev.
- [ ] **OpenAI**: create an API key at
  https://platform.openai.com/api-keys → `OPENAI_API_KEY` (used for both the
  agent's tool-calling and embeddings — see PLAN.md decision D5).
- [ ] **GitHub**: create the remote repository and push this local repo
  (`git remote add origin <url> && git push -u origin main`). The CI
  workflow at `.github/workflows/ci.yml` will start running once the repo
  exists on GitHub — nothing else to configure.
- [ ] **Vercel**: import the GitHub repo and set the same env vars
  (`OPENAI_API_KEY`, `DATABASE_URL`) as project environment variables for
  deployment (see Module F in `PLAN.md`).
