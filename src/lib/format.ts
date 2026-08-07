/**
 * Small formatting helpers shared across the app.
 *
 * This module exists mainly as an F0 scaffolding smoke test target — real
 * domain logic (tasks, agent, RAG) lands in later phases per PLAN.md.
 */

/** Trims a project name and collapses internal whitespace for display. */
export function formatProjectTitle(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
