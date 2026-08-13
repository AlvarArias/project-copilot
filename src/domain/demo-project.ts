/**
 * The MVP has no auth and serves a single shared demo project (PLAN.md
 * decision 3). Its name is a domain-level constant rather than a `seed.ts`
 * local so `/api/chat` (and any other route that needs to resolve "the"
 * project without a user-supplied id) can import it without depending on
 * the seed script.
 */
export const DEMO_PROJECT_NAME = "Lanzamiento MarketPulse — App Móvil de Analítica";
