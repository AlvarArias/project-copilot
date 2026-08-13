/**
 * Date normalization shared by the agent tools (`src/domain/agent/tools.ts`)
 * and any future importer that needs to turn loosely-formatted date strings
 * (LLM output, pasted spreadsheet data) into the `YYYY-MM-DD` shape the
 * `tasks` table expects.
 *
 * Ported from `reference-ui/gantt.js` `normalizeDate` (see PLAN.md risk R5).
 * That original has a documented bug: its last-resort `new Date(str)` parse
 * reads the string as LOCAL time, then `.toISOString()` converts to UTC —
 * in timezones ahead of UTC this silently shifts date-only strings back by
 * one day (see `reference-ui/gantt.test.js`, "BUG: native Date fallback can
 * shift the date by one day"). This port fixes that by re-deriving the UTC
 * calendar date from the parsed local Y/M/D components instead of trusting
 * `toISOString()` on the original (implicitly local) `Date`.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})T/;

/** Whether `value` is a real calendar date in `YYYY-MM-DD` form (rejects e.g. "2025-02-30"). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/**
 * Normalizes a loosely-formatted date into `YYYY-MM-DD`, or `null` if it
 * can't be confidently parsed. Accepts (in order of precedence):
 *   - `YYYY-MM-DD` — passthrough
 *   - `YYYY-MM-DDTHH:mm:ss(.sss)?Z?` — takes the date portion verbatim
 *   - `M/D/YY` or `M/D/YYYY` — the Google Sheets default
 *   - `DD-MM-YYYY` — dash-separated, day first
 *   - anything else recognized by the native `Date` parser, reinterpreted
 *     as a UTC calendar date to avoid the timezone shift described above
 *
 * Every candidate is validated with {@link isIsoDate} before being
 * accepted, so malformed lookalikes (e.g. a 3-part dash string that isn't
 * actually numeric) fall through to the next strategy instead of producing
 * garbage output.
 */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const str = value.trim();
  if (!str) return null;

  if (isIsoDate(str)) return str;

  const isoDatetimeMatch = ISO_DATETIME_PREFIX_RE.exec(str);
  if (isoDatetimeMatch && isIsoDate(isoDatetimeMatch[1])) {
    return isoDatetimeMatch[1];
  }

  if (str.includes("/")) {
    const parts = str.split("/");
    if (parts.length === 3) {
      const month = parts[0].padStart(2, "0");
      const day = parts[1].padStart(2, "0");
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      const candidate = `${year}-${month}-${day}`;
      if (isIsoDate(candidate)) return candidate;
    }
  }

  const dashParts = str.split("-");
  if (dashParts.length === 3 && dashParts[2].length === 4) {
    const day = dashParts[0].padStart(2, "0");
    const month = dashParts[1].padStart(2, "0");
    const year = dashParts[2];
    const candidate = `${year}-${month}-${day}`;
    if (isIsoDate(candidate)) return candidate;
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const utc = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    return utc.toISOString().slice(0, 10);
  }

  return null;
}
