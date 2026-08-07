import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { installDom } from './dom-fixture.js';

const require = createRequire(import.meta.url);

// gantt.js reads TEST_MODE / MOCK_GANTT / authHeaders / GANTT_ENDPOINT / Gantt / Chart
// as globals (they're normally defined by config.js + app.js, loaded as separate
// <script> tags before gantt.js in index.html). We stub them on `global` before
// requiring the module, then delete the cached module between tests so each test
// gets a fresh copy with fresh globals.
function loadGanttModule(globals = {}) {
  installDom();

  global.TEST_MODE = false;
  global.authHeaders = { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' };
  global.GANTT_ENDPOINT = 'https://example.test/gantt-data';
  global.MOCK_GANTT = [];
  // gantt.js / app.js are loaded as sibling <script> tags in the browser and share
  // one global scope, so `tasks` and `ganttInstance` (declared with `let` in app.js)
  // are visible to gantt.js without an import. Under Node/CommonJS there is no such
  // sharing, so we seed them as globals here to reproduce the browser's runtime shape.
  global.tasks = [];
  global.ganttInstance = null;
  global.Gantt = vi.fn().mockImplementation(function (selector, tasksArg) {
    this.gantt_end = new Date('2099-01-01'); // large enough to skip the re-render branch by default
    this.render = vi.fn();
    this.refresh = vi.fn();
    this.change_view_mode = vi.fn();

    // Frappe Gantt wraps the SVG in its own `div.gantt-container` on construction
    // (see CLAUDE.md "DOM structure"). syncScroll()/scrollToBar() query for it,
    // so the mock must reproduce that wrapping or those calls fail.
    const outer = document.getElementById('gantt-container');
    if (outer && !outer.querySelector('.gantt-container')) {
      const inner = document.createElement('div');
      inner.className = 'gantt-container';
      inner.appendChild(document.getElementById('gantt'));
      outer.appendChild(inner);
    }
  });

  Object.assign(global, globals);

  // `require` here is Node's native CommonJS loader (via createRequire), which
  // has its own module cache separate from Vitest's `vi.resetModules()`. Clear
  // it manually so each test gets a fresh evaluation of gantt.js.
  delete require.cache[require.resolve('../../assets/js/gantt.js')];
  return require('../../assets/js/gantt.js');
}

describe('normalizeDate', () => {
  let gantt;
  beforeEach(() => { gantt = loadGanttModule(); });

  it('passes through an already-valid YYYY-MM-DD date', () => {
    expect(gantt.normalizeDate('2025-01-06')).toBe('2025-01-06');
  });

  it('converts M/D/YY (Google Sheets default) to YYYY-MM-DD', () => {
    expect(gantt.normalizeDate('1/6/25')).toBe('2025-01-06');
  });

  it('converts M/D/YYYY to YYYY-MM-DD', () => {
    expect(gantt.normalizeDate('1/6/2025')).toBe('2025-01-06');
  });

  it('pads single-digit month/day for slash format', () => {
    expect(gantt.normalizeDate('3/9/2025')).toBe('2025-03-09');
  });

  it('converts DD-MM-YYYY (dashes) to YYYY-MM-DD', () => {
    expect(gantt.normalizeDate('01-06-2025')).toBe('2025-06-01');
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(gantt.normalizeDate('  2025-01-06  ')).toBe('2025-01-06');
  });

  it('falls back to native Date parsing for other formats (explicit UTC input)', () => {
    // Using an explicit UTC timestamp avoids a real timezone bug in the fallback
    // branch (see the dedicated test below) that would otherwise make this
    // assertion flaky depending on the machine's local timezone.
    expect(gantt.normalizeDate('2025-01-06T00:00:00Z')).toBe('2025-01-06');
  });

  it('BUG: native Date fallback can shift the date by one day in non-UTC timezones', () => {
    // `new Date('January 6, 2025')` is parsed as LOCAL midnight, then
    // `.toISOString()` converts to UTC. In any timezone ahead of UTC (e.g.
    // Europe/Stockholm, UTC+1), local midnight Jan 6 is Jan 5 23:00 UTC, so
    // normalizeDate silently returns the WRONG day ("2025-01-05" instead of
    // "2025-01-06"). This only affects the last-resort fallback branch (inputs
    // that aren't YYYY-MM-DD, M/D/YY, or DD-MM-YYYY) — real n8n/Sheets data
    // uses those formats, so the practical blast radius is limited, but it is
    // a genuine bug worth fixing (e.g. parse date-only strings as UTC).
    const result = gantt.normalizeDate('January 6, 2025');
    const localOffsetMinutes = new Date('2025-01-06T00:00:00').getTimezoneOffset();
    if (localOffsetMinutes < 0) {
      // Timezone ahead of UTC (e.g. UTC+1): expect the off-by-one-day bug.
      expect(result).toBe('2025-01-05');
    } else {
      // Timezone at or behind UTC: no shift occurs.
      expect(result).toBe('2025-01-06');
    }
  });

  it('returns null for an empty string', () => {
    expect(gantt.normalizeDate('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(gantt.normalizeDate(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(gantt.normalizeDate(undefined)).toBeNull();
  });

  it('returns null for a non-string input', () => {
    expect(gantt.normalizeDate(20250106)).toBeNull();
  });

  it('returns null for a garbage string with no separators', () => {
    expect(gantt.normalizeDate('garbage')).toBeNull();
  });

  it('BUG: a non-numeric 3-part dash string with a 4-char last segment is misparsed instead of rejected', () => {
    // The DD-MM-YYYY branch only checks `dashParts.length === 3 && dashParts[2].length === 4`
    // without validating that the parts are numeric. "not-a-date" splits into
    // ['not','a','date'] — 3 parts, last part has 4 chars — so it slips through
    // and produces garbage ("date-0a-not") instead of returning null.
    expect(gantt.normalizeDate('not-a-date')).toBe('date-0a-not');
  });
});

describe('formatDate', () => {
  let gantt;
  beforeEach(() => { gantt = loadGanttModule(); });

  it('formats an ISO date as "Mon D"', () => {
    expect(gantt.formatDate('2025-01-06')).toBe('Jan 6');
  });

  it('does not zero-pad the day', () => {
    expect(gantt.formatDate('2025-03-09')).toBe('Mar 9');
  });

  it('formats December correctly (last month index)', () => {
    expect(gantt.formatDate('2025-12-31')).toBe('Dec 31');
  });
});

describe('daysBetween', () => {
  let gantt;
  beforeEach(() => { gantt = loadGanttModule(); });

  it('computes the number of days between two ISO dates', () => {
    expect(gantt.daysBetween('2025-01-01', '2025-01-10')).toBe(9);
  });

  it('returns 0 for the same start and end date', () => {
    expect(gantt.daysBetween('2025-01-01', '2025-01-01')).toBe(0);
  });

  it('handles spans across a month boundary', () => {
    expect(gantt.daysBetween('2025-01-25', '2025-02-05')).toBe(11);
  });
});

describe('applyHighlights', () => {
  let gantt;

  beforeEach(() => {
    gantt = loadGanttModule();
  });

  it('does nothing when ganttInstance has not been created', () => {
    // ganttInstance is module-internal state; without calling loadGantt() first
    // it stays null, so applyHighlights should be a no-op and not throw.
    expect(() => gantt.applyHighlights(['Kick-off'])).not.toThrow();
  });

  it('does nothing when highlights is not an array', async () => {
    await seedGanttInstance(gantt);
    expect(() => gantt.applyHighlights(null)).not.toThrow();
    expect(() => gantt.applyHighlights('not-an-array')).not.toThrow();
  });

  it('marks matching tasks as bar-highlight (case-insensitive) and others as bar-default', async () => {
    await seedGanttInstance(gantt);
    gantt.applyHighlights(['kick-off']); // lowercase on purpose

    const panel = document.getElementById('gantt-left-panel');
    const rows = [...panel.querySelectorAll('.lp-row')];
    const kickOffRow = rows.find(r => r.querySelector('.lp-name').title === 'Kick-off');
    const otherRow = rows.find(r => r.querySelector('.lp-name').title !== 'Kick-off');

    expect(kickOffRow.className).toContain('bar-highlight');
    expect(otherRow.className).toContain('bar-default');
  });

  it('toggles the has-highlights class on the wrapper based on highlights length', async () => {
    await seedGanttInstance(gantt);
    gantt.applyHighlights(['Kick-off']);
    expect(document.getElementById('gantt-wrapper').classList.contains('has-highlights')).toBe(true);

    gantt.applyHighlights([]);
    expect(document.getElementById('gantt-wrapper').classList.contains('has-highlights')).toBe(false);
  });

  // Helper: run loadGantt() with two mock tasks so ganttInstance/tasks are populated.
  async function seedGanttInstance(g) {
    global.TEST_MODE = true;
    global.MOCK_GANTT = [
      { deliverable: 'Kick-off', start: '2025-01-06', end: '2025-01-10' },
      { deliverable: 'Design', start: '2025-01-13', end: '2025-02-07' },
    ];
    await g.loadGantt();
  }
});

describe('scrollToBar', () => {
  let gantt;
  beforeEach(() => { gantt = loadGanttModule(); });

  it('does nothing (no throw) when the inner .gantt-container is missing', () => {
    // Simulate loadGantt() never having run (Gantt mock never wrapped the SVG).
    expect(() => gantt.scrollToBar('task-0')).not.toThrow();
  });

  it('does nothing (no throw) when no bar-wrapper matches the given task id', async () => {
    global.TEST_MODE = true;
    global.MOCK_GANTT = [{ deliverable: 'Solo', start: '2025-01-01', end: '2025-01-05' }];
    await gantt.loadGantt();
    expect(() => gantt.scrollToBar('does-not-exist')).not.toThrow();
  });

  it('calls scrollTo with a centered, non-negative scrollLeft for the matching bar', async () => {
    global.TEST_MODE = true;
    global.MOCK_GANTT = [{ deliverable: 'Solo', start: '2025-01-01', end: '2025-01-05' }];
    await gantt.loadGantt();

    const inner = document.querySelector('#gantt-container .gantt-container');
    Object.defineProperty(inner, 'clientWidth', { value: 200, configurable: true });
    inner.scrollTo = vi.fn();

    const wrapper = document.createElement('div');
    wrapper.className = 'bar-wrapper';
    wrapper.dataset.id = 'task-0';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('x', '500');
    bar.setAttribute('width', '100');
    wrapper.appendChild(bar);
    inner.appendChild(wrapper);

    gantt.scrollToBar('task-0');

    // x=500, width=100 → center=550; 550 - clientWidth/2(100) = 450
    expect(inner.scrollTo).toHaveBeenCalledWith({ left: 450, behavior: 'smooth' });
  });

  it('clamps scrollLeft to 0 instead of going negative for a bar near the start', async () => {
    global.TEST_MODE = true;
    global.MOCK_GANTT = [{ deliverable: 'Solo', start: '2025-01-01', end: '2025-01-05' }];
    await gantt.loadGantt();

    const inner = document.querySelector('#gantt-container .gantt-container');
    Object.defineProperty(inner, 'clientWidth', { value: 2000, configurable: true });
    inner.scrollTo = vi.fn();

    const wrapper = document.createElement('div');
    wrapper.className = 'bar-wrapper';
    wrapper.dataset.id = 'task-0';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('x', '10');
    bar.setAttribute('width', '20');
    wrapper.appendChild(bar);
    inner.appendChild(wrapper);

    gantt.scrollToBar('task-0');

    expect(inner.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });
});

describe('loadGantt', () => {
  it('loads MOCK_GANTT data when TEST_MODE is true, sorted by start date', async () => {
    const gantt = loadGanttModule();
    global.TEST_MODE = true;
    global.MOCK_GANTT = [
      { deliverable: 'Second', start: '2025-02-01', end: '2025-02-10' },
      { deliverable: 'First', start: '2025-01-01', end: '2025-01-10' },
    ];

    await gantt.loadGantt();

    expect(document.getElementById('gantt-wrapper').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('gantt-loading').classList.contains('hidden')).toBe(true);

    const panel = document.getElementById('gantt-left-panel');
    const names = [...panel.querySelectorAll('.lp-row .lp-name')].map(el => el.title);
    expect(names).toEqual(['First', 'Second']);
  });

  it('fetches from GANTT_ENDPOINT with auth headers when TEST_MODE is false', async () => {
    const gantt = loadGanttModule();
    global.TEST_MODE = false;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { deliverable: 'Task A', start: '2025-01-01', end: '2025-01-05' },
      ]),
    });

    await gantt.loadGantt();

    expect(global.fetch).toHaveBeenCalledWith('https://example.test/gantt-data', {
      headers: global.authHeaders,
    });
    expect(document.getElementById('gantt-error').classList.contains('hidden')).toBe(true);
  });

  it('shows an error message when the fetch response is not ok', async () => {
    const gantt = loadGanttModule();
    global.TEST_MODE = false;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await gantt.loadGantt();

    const errorEl = document.getElementById('gantt-error');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toContain('HTTP 500');
  });

  it('shows an error message when all rows have unparseable dates', async () => {
    const gantt = loadGanttModule();
    global.TEST_MODE = true;
    global.MOCK_GANTT = [
      { deliverable: 'Bad row', start: 'not-a-date-at-all-####', end: 'also-bad-####' },
    ];
    // Force normalizeDate to fail by using values Date() also can't parse.
    // "not-a-date-at-all-####" fails the regexes and native Date parsing.

    await gantt.loadGantt();

    const errorEl = document.getElementById('gantt-error');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toContain('No valid tasks found');
  });

  it('skips only the invalid rows and keeps the valid ones', async () => {
    const gantt = loadGanttModule();
    global.TEST_MODE = true;
    global.MOCK_GANTT = [
      { deliverable: 'Good', start: '2025-01-01', end: '2025-01-05' },
      { deliverable: 'Bad', start: 'not-a-date-at-all-####', end: 'also-bad-####' },
    ];

    await gantt.loadGantt();

    const panel = document.getElementById('gantt-left-panel');
    const names = [...panel.querySelectorAll('.lp-row .lp-name')].map(el => el.title);
    expect(names).toEqual(['Good']);
  });
});

describe('switchView', () => {
  let gantt;
  beforeEach(() => { gantt = loadGanttModule(); });

  it('shows the dashboard view and hides the gantt view + view controls', () => {
    gantt.switchView('dashboard');

    expect(document.getElementById('dashboard-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('gantt-view').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('gantt-view-controls').classList.contains('hidden')).toBe(true);
  });

  it('shows the gantt view and hides the dashboard view when switching back', () => {
    gantt.switchView('dashboard');
    gantt.switchView('gantt');

    expect(document.getElementById('gantt-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('dashboard-view').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('gantt-view-controls').classList.contains('hidden')).toBe(false);
  });

  it('marks the matching tab button as active', () => {
    gantt.switchView('dashboard');
    const dashboardTab = document.querySelector('.btn-tab[data-tab="dashboard"]');
    const ganttTab = document.querySelector('.btn-tab[data-tab="gantt"]');

    expect(dashboardTab.classList.contains('active')).toBe(true);
    expect(ganttTab.classList.contains('active')).toBe(false);
  });
});

describe('renderDashboardPanel', () => {
  let gantt;
  beforeEach(() => {
    gantt = loadGanttModule();
    global.Chart = vi.fn();
  });

  it('renders the title and KPI cards into #db-content', () => {
    gantt.renderDashboardPanel({
      title: 'Risk Dashboard',
      answer: 'Summary text',
      data: {
        kpis: [
          { label: 'Total', value: 51, color: '#5b8dee' },
          { label: 'High', value: 15, color: '#e05252' },
        ],
        charts: [],
      },
    });

    const content = document.getElementById('db-content');
    expect(content.querySelector('.db-title').textContent).toBe('Risk Dashboard');
    expect(content.querySelector('.db-subtitle').textContent).toBe('Summary text');
    expect(content.querySelectorAll('.db-kpi-card').length).toBe(2);
    expect(document.getElementById('db-empty').classList.contains('hidden')).toBe(true);
    expect(content.classList.contains('hidden')).toBe(false);
  });

  it('falls back to a default title when data.title is missing', () => {
    gantt.renderDashboardPanel({ data: {} });
    expect(document.getElementById('db-content').querySelector('.db-title').textContent)
      .toBe('Dashboard de Riesgos');
  });

  it('instantiates a Chart per chart definition with default colors when colors[] is absent', () => {
    gantt.renderDashboardPanel({
      title: 'T',
      data: {
        kpis: [],
        charts: [
          { id: 'by-cat', type: 'bar', title: 'By category', labels: ['A', 'B'], values: [1, 2], color: '#123456' },
        ],
      },
    });

    expect(global.Chart).toHaveBeenCalledTimes(1);
    const [, config] = global.Chart.mock.calls[0];
    expect(config.data.datasets[0].backgroundColor).toEqual(['#123456', '#123456']);
  });

  it('uses per-slice colors[] when provided (e.g. doughnut charts)', () => {
    gantt.renderDashboardPanel({
      title: 'T',
      data: {
        kpis: [],
        charts: [
          {
            id: 'by-sev', type: 'doughnut', title: 'By severity',
            labels: ['High', 'Med', 'Low'], values: [1, 2, 3],
            colors: ['#e05252', '#f6a623', '#27ae60'],
          },
        ],
      },
    });

    const [, config] = global.Chart.mock.calls[0];
    expect(config.data.datasets[0].backgroundColor).toEqual(['#e05252', '#f6a623', '#27ae60']);
  });

  it('does not render a KPI grid or chart grid when both are empty/absent', () => {
    gantt.renderDashboardPanel({ title: 'Empty', data: {} });
    const content = document.getElementById('db-content');
    expect(content.querySelector('.db-kpis')).toBeNull();
    expect(content.querySelector('.db-charts')).toBeNull();
  });
});
