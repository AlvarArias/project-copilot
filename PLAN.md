# 📋 Plan de Desarrollo — Project Copilot (MVP)

**Versión**: 1.1 · **Fecha**: 2026-08-07 · **Estado**: ✅ Aprobado — listo para implementación

> Cambios desde v1.0: se cerraron las 4 preguntas abiertas (backend TypeScript full-stack; embeddings OpenAI `text-embedding-3-small` → `vector(1536)`; sin login / proyecto demo único; RAG solo PDF + Markdown/TXT). Se eliminó la sección de Open Questions, se fijó el stack y se ajustaron los riesgos dependientes.

Este documento es la **fuente de verdad** para la implementación fase por fase por parte de code-dev-coordinator.

---

## 1. App Overview

**Qué es**: un copiloto de IA para gestión de proyectos. El usuario conversa en lenguaje natural con un agente que **manipula un Gantt real** (crear, mover, reprogramar tareas), **detecta conflictos de fechas/dependencias**, y **responde preguntas sobre el proyecto usando RAG** sobre documentos que el usuario sube (specs, actas, notas), citando la fuente.

**Usuario objetivo**: PMs, tech leads y equipos pequeños que quieren editar un cronograma "hablando" en vez de arrastrar barras.

**Propuesta de valor / propósito (portafolio)**: pieza que demuestra —de forma limpia y con demo en vivo— los patrones que piden las vacantes GenAI/Agentic:
- **Agent loop con tool-calling** (el agente ejecuta herramientas contra la BD).
- **RAG con citas** sobre pgvector.
- **UI de streaming** (chat + Gantt que se actualiza en vivo).
- **Arquitectura limpia + tests + CI/CD + demo desplegado sin costo**.

**Anti-objetivo explícito**: no construir un SaaS completo (multi-org, billing, permisos finos, colaboración en tiempo real). Calidad de patrones > cantidad de features.

---

## 2. Feature Breakdown

**Módulo A — Chat Copiloto (streaming)**
- A1. Entrada de chat + historial de conversación por proyecto.
- A2. Respuestas en streaming (SSE) token a token.
- A3. Indicador de "acciones" del agente (qué herramienta ejecutó: "creé la tarea X", "moví Y").
- A4. Quick-actions (botones sugeridos), reusando el patrón del reference-ui.

**Módulo B — Gantt (visualización + edición vía agente)**
- B1. Render del Gantt adaptado de `reference-ui` a React/TS, leyendo de la BD.
- B2. Panel izquierdo (deliverable / start / end / days) + scroll sincronizado.
- B3. Actualización en vivo: cuando el agente ejecuta una tool que cambia tareas, el Gantt se re-renderiza sin recargar.
- B4. Resaltado de tareas referenciadas por el agente (`bar-highlight`, ya existe en la referencia).

**Módulo C — Agente de IA (tool-calling)**
- C1. Loop de agente con Claude (`claude-opus-4-8`) + herramientas.
- C2. Tools de tareas: `create_task`, `update_task` (mover/reprogramar), `delete_task`, `list_tasks`.
- C3. Tool de análisis: `detect_conflicts` (solapes de fecha, violaciones de dependencia, fin-antes-de-inicio).
- C4. Tool de RAG: `search_documents` (retrieval sobre pgvector, devuelve chunks + fuente para citar).
- C5. System prompt + política de herramientas (cuándo usar cada una; descripciones "call this when…").

**Módulo D — RAG / Documentos**
- D1. Subida de documentos por proyecto (**PDF + Markdown/TXT**).
- D2. Pipeline de ingesta: extraer texto → chunking → embeddings (OpenAI) → guardar en pgvector.
- D3. Búsqueda por similitud (cosine, operador pgvector) top-k.
- D4. Citas en la respuesta del chat (nombre de archivo + fragmento).

**Módulo E — Proyecto / Persistencia**
- E1. Concepto de "proyecto" (contenedor de tareas + documentos + conversación). **Un único proyecto demo compartido, sin autenticación.**
- E2. Seed de un proyecto de ejemplo para que la demo tenga contenido al abrir.

**Módulo F — Plataforma / Calidad**
- F1. Migraciones de BD + habilitar pgvector.
- F2. Tests unitarios (tools, repos, ingesta) + al menos 1 test de integración del agent loop.
- F3. Docker + CI (lint + test) + despliegue (Vercel + Supabase).
- F4. README con arquitectura, decisiones y GIF/loom de la demo.

---

## 3. Data Model (PostgreSQL + pgvector — única BD)

```
projects
  id            uuid pk
  name          text
  created_at    timestamptz

tasks
  id            uuid pk
  project_id    uuid fk -> projects
  name          text
  start_date    date
  end_date      date
  progress      int  default 0        -- 0..100
  status        text default 'planned'
  created_at    timestamptz
  updated_at    timestamptz

task_dependencies                      -- dependencias (para conflictos)
  task_id       uuid fk -> tasks
  depends_on_id uuid fk -> tasks
  pk (task_id, depends_on_id)

documents
  id            uuid pk
  project_id    uuid fk -> projects
  filename      text
  mime_type     text                   -- application/pdf | text/markdown | text/plain
  uploaded_at   timestamptz
  status        text                   -- 'processing' | 'ready' | 'error'

document_chunks
  id            uuid pk
  document_id   uuid fk -> documents
  project_id    uuid fk -> projects    -- denormalizado para filtrar rápido en RAG
  chunk_index   int
  content       text
  token_count   int
  embedding     vector(1536)           -- OpenAI text-embedding-3-small = 1536 dims
  -- índice ivfflat o hnsw sobre embedding (vector_cosine_ops)

messages                               -- historial de chat
  id            uuid pk
  project_id    uuid fk -> projects
  role          text                   -- 'user' | 'assistant'
  content       text
  tool_calls    jsonb                  -- auditoría de qué tools se ejecutaron (opcional, buen detalle)
  created_at    timestamptz
```

**Relaciones**: `project 1—* tasks`, `project 1—* documents 1—* chunks`, `project 1—* messages`, `tasks *—* tasks` (dependencias).

**Mapeo al componente Gantt**: `tasks.name→name`, `start_date→start`, `end_date→end`, `progress→progress`, `id→id` (forma esperada por el reference-ui: `{id, name, start, end, progress, custom_class}`).

---

## 4. Technology Stack

| Capa | Elección | Justificación |
|---|---|---|
| Frontend | **Next.js (App Router) + TypeScript + React** | Patrón exacto de las vacantes; rutas API integradas; deploy gratis en Vercel. |
| UI Gantt | **Adaptación de `reference-ui`** (Frappe Gantt / SVG) envuelta en React | Ya funciona y es propio; wrapper con `useRef` + `refresh(tasks)`. |
| Streaming | **SSE** (`text/event-stream`) | Coincide 1:1 con el streaming nativo de la Claude API; más simple que WebSockets para chat. |
| Backend/Agente | **Next.js API routes en TypeScript** con el **SDK oficial de Anthropic** (`@anthropic-ai/sdk`), modelo `claude-opus-4-8`, `thinking: adaptive`, `effort` ajustable | **Q1 cerrada: TypeScript full-stack.** Un solo lenguaje/vendor de deploy, código cohesionado; Node está aceptado en las vacantes investigadas. |
| Base de datos | **PostgreSQL + pgvector en Supabase (free)** | Una sola BD para datos estructurados + embeddings; demo en vivo sin costo. |
| Embeddings | **OpenAI `text-embedding-3-small` (1536 dims)** vía `EmbeddingsProvider` (interfaz) | **Q2 cerrada.** Razón: "OpenAI" apareció como keyword explícito en las vacantes reales; se prioriza reconocibilidad de mercado. Detrás de interfaz para poder cambiarlo. |
| Auth | **Ninguna** — proyecto demo único compartido | **Q3 cerrada.** Máxima rapidez a demo; Auth queda como nice-to-have documentado. |
| Formatos RAG | **PDF + Markdown + TXT** | **Q4 cerrada.** `.docx` fuera del MVP. |
| Tests | Vitest (TS) | La referencia ya usa Vitest. |
| Infra | Docker + GitHub Actions (lint + test) | Patrón de vacante; CI barato. |
| Deploy | Vercel (frontend + API routes) + Supabase (BD) | Todo en capa gratuita, un solo servicio de app. |

**Variables de entorno clave**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL` (Supabase / pgvector).

---

## 5. Architecture Overview (clean architecture)

```
┌─────────────────────────── Frontend (Next.js + TS) ───────────────────────────┐
│  ChatPanel (SSE)   GanttView (React wrapper del reference-ui)   DocUpload      │
└───────────────┬───────────────────────────────┬───────────────────────────────┘
                │ POST /api/chat (stream SSE)    │ REST: /api/tasks, /api/documents
                ▼                                ▼
┌──────────────────────────── Capa API / Orquestación ──────────────────────────┐
│  chat handler (stream)          tasks handler          documents handler       │
│         │                                                                       │
│         ▼                                                                       │
│  ┌───────────── Agente (dominio) ─────────────┐                                 │
│  │  agent loop (Claude tool-calling)          │                                 │
│  │  tools: create/update/delete/list_task,    │                                 │
│  │         detect_conflicts, search_documents │                                 │
│  └──────┬───────────────────────┬─────────────┘                                 │
│         ▼                       ▼                                                │
│   TasksRepository        RAG service (chunk→embed→search)                       │
└─────────┬───────────────────────┬───────────────────────────────────────────────┘
          ▼                       ▼
   Postgres (tasks, deps)   Postgres + pgvector (document_chunks)   ← misma BD Supabase
          ▲                       ▲
   Anthropic client (agente)   OpenAI client (embeddings)
```

Monolito modular con separación estricta: **UI → API → Agente/Dominio → Repositorios → Infra**. Las tools del agente no tocan HTTP ni Claude directamente; solo invocan repos/servicios (testeables con mocks). El `EmbeddingsProvider` y el cliente Anthropic viven en la capa de infraestructura tras interfaces.

---

## 6. Agent Coordination Map

Ejecución feature-por-feature vía **code-dev-coordinator**, que orquesta a los agentes de código:

| Área del plan | Agente responsable | Alcance |
|---|---|---|
| Esquema BD, repos, migraciones | clean-code-architect + idiomatic-code-writer | Schema, pgvector, repositorios con interfaces. |
| Agente + tools + system prompt | clean-code-architect | Loop de tool-calling, definición/validación de tools, streaming SSE. |
| Pipeline RAG (chunking, embeddings OpenAI, search) | clean-code-architect | Ingesta + búsqueda vectorial + citas. |
| UI Gantt (React wrapper) + Chat streaming | idiomatic-code-writer | Adaptar reference-ui, consumo SSE en cliente. |
| Revisión de diseño/SOLID | solid-code-reviewer | Revisión por fase antes de cerrar. |
| Tests | unit-test-writer + xtest-debugger | Cobertura de tools/repos/ingesta + integración del loop. |
| Diagramas/README | code-explainer | Diagramas Mermaid de modelo y arquitectura. |

*(app-coordinator planifica; no ejecuta código. Este plan se entrega a code-dev-coordinator.)*

---

## 7. Development Phases & Milestones

| Fase | Entregable | Hito verificable |
|---|---|---|
| **F0 — Scaffolding** | Monorepo Next.js+TS, env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`), proyecto Supabase, pgvector habilitado, CI (lint+test) skeleton, Dockerfile | `npm run dev` levanta; CI verde en PR vacío. |
| **F1 — Data layer** | Migraciones (projects, tasks, deps, documents, chunks `vector(1536)`, messages), repos, seed de proyecto ejemplo | Seed cargado; repos con tests unitarios. |
| **F2 — Gantt UI (read-only)** | `GanttView` React que renderiza tareas desde la BD | Gantt muestra el seed en pantalla. |
| **F3 — Agente + tools de tareas** | Loop tool-calling + `create/update/delete/list_task`, endpoint `/api/chat` con SSE | "Crea una tarea Diseño del 1 al 5 de sept" persiste y responde en streaming. |
| **F4 — Chat UI + Gantt en vivo** | ChatPanel con SSE; Gantt se actualiza al ejecutar tools; highlight | Conversación mueve una barra visible sin recargar. |
| **F5 — RAG** | Subida de docs (PDF/MD/TXT), ingesta (chunk + embeddings OpenAI), `search_documents`, citas | "¿Qué dice el spec sobre X?" responde citando el archivo. |
| **F6 — Conflictos + pulido** | `detect_conflicts` + UX de errores/estados vacíos | "¿Hay conflictos?" lista solapes/dependencias inválidas. |
| **F7 — Tests + deploy + README** | Cobertura clave, 1+ test de integración del loop, deploy Vercel+Supabase, README + demo | URL pública funcionando; README con arquitectura y decisiones. |

---

## 8. Task Dependencies

```
F0 ─► F1 ─► F2 ─► F4
           └► F3 ─► F4 ─► F5 ─► F6 ─► F7
F1 ─► F3
F1 ─► F5   (chunks/embeddings dependen del esquema)
```
- **F2 y F3** pueden ir en paralelo tras F1; convergen en **F4**.
- **F5 (RAG)** requiere F1 (tabla chunks) + F3 (loop de agente donde enchufar `search_documents`).
- **F7** cierra todo.

---

## 9. Risk Assessment

- **R1 — Deuda de portabilidad de embeddings**: se fijó OpenAI `text-embedding-3-small` (1536 dims). *Mitigación*: `EmbeddingsProvider` tras interfaz; la dimensión `vector(1536)` queda acoplada al esquema — un cambio de proveedor implicaría re-embedding + migración de la columna.
- **R2 — Segundo vendor (OpenAI además de Anthropic)**: dos API keys/costos. *Mitigación*: uso mínimo (solo embeddings); `text-embedding-3-small` es muy barato; documentar en README.
- **R3 — Límites free tier Supabase** (pausa por inactividad, tamaño): aceptable para demo; documentar en README.
- **R4 — Adaptar Frappe Gantt (SVG imperativo) a React**: la referencia manipula el DOM directamente. *Mitigación*: wrapper con `useRef` + método `refresh(tasks)`; no re-montar en cada render.
- **R5 — Parseo de fechas / zonas horarias** en las tools: normalizar a `YYYY-MM-DD` (la referencia trae `normalizeDate`).
- **R6 — Extracción de texto de PDF en entorno serverless (Vercel)**: elegir una lib de parseo PDF compatible con el runtime de las API routes. *Mitigación*: validar en F5; fallback a procesar la ingesta fuera del edge runtime (Node runtime) si hace falta.
- **R7 — Frontend genérico por defecto del modelo**: especificar paleta/tipografía en los prompts de UI para evitar estética "AI slop".
- **R8 — Alcance creep**: mantener el anti-objetivo (no SaaS). Cualquier feature nueva se evalúa contra "¿demuestra un patrón de vacante?".

---

## 10. Decisiones cerradas (antes "Open Questions")

1. **Backend** → **TypeScript full-stack (Next.js API routes)**. Un solo lenguaje y servicio de deploy; Node aceptado en las vacantes.
2. **Embeddings** → **OpenAI `text-embedding-3-small` (1536 dims)**. Motivo: "OpenAI" apareció como keyword explícito en las vacantes reales; se prioriza reconocibilidad de mercado sobre el argumento de ecosistema Anthropic (Voyage no apareció en ninguna vacante).
3. **Auth** → **Sin login; un único proyecto demo compartido**. Auth queda como nice-to-have documentado.
4. **Formatos RAG** → **PDF + Markdown + TXT** (sin `.docx` en el MVP).

**Supuestos vigentes**: interfaz en español/bilingüe (el agente responde en el idioma del usuario); SSE para streaming; seed de proyecto pre-cargado; vista "Dashboard" de la referencia solo si sobra tiempo (fuera del core); modelo por defecto `claude-opus-4-8` con streaming.

---

**Estado**: ✅ Aprobado. Listo para entregar a **code-dev-coordinator** para implementación fase por fase (F0 → F7).
