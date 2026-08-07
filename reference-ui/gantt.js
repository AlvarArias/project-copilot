// ── Gantt ─────────────────────────────────────────────────────────────────────
// Depends on globals: tasks, ganttInstance, TEST_MODE, authHeaders,
//                     MOCK_GANTT, GANTT_ENDPOINT  (defined in config.js / app.js)

// Converts M/D/YY, M/D/YYYY, DD-MM-YYYY → YYYY-MM-DD; passes through YYYY-MM-DD unchanged.
function normalizeDate(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim();
  if (!str) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // M/D/YY or M/D/YYYY (Google Sheets default)
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      const m = parts[0].padStart(2, '0');
      const d = parts[1].padStart(2, '0');
      const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
      return `${y}-${m}-${d}`;
    }
  }

  // DD-MM-YYYY with dashes (e.g. "01-06-2025")
  const dashParts = str.split('-');
  if (dashParts.length === 3 && dashParts[2].length === 4) {
    const d = dashParts[0].padStart(2, '0');
    const m = dashParts[1].padStart(2, '0');
    const y = dashParts[2];
    return `${y}-${m}-${d}`;
  }

  // Last resort: native Date parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return null;
}

async function loadGantt() {
  const loadingEl   = document.getElementById('gantt-loading');
  const errorEl     = document.getElementById('gantt-error');
  const containerEl = document.getElementById('gantt-wrapper');

  try {
    const data = TEST_MODE
      ? MOCK_GANTT
      : await fetch(GANTT_ENDPOINT, { headers: authHeaders })
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

    const invalid = [];
    tasks = data
      .map(item => {
        const start = normalizeDate(item.start);
        const end   = normalizeDate(item.end);
        if (!start || !end) {
          invalid.push(`"${item.deliverable}" (start="${item.start}", end="${item.end}")`);
          return null;
        }
        return { name: item.deliverable, start, end, progress: 0, custom_class: 'bar-default' };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .map((t, i) => ({ ...t, id: `task-${i}` }));

    if (invalid.length) console.warn('Gantt: skipped rows with unparseable dates:', invalid);
    if (!tasks.length) throw new Error('No valid tasks found — check date formats in the spreadsheet.');

    loadingEl.classList.add('hidden');
    containerEl.classList.remove('hidden');

    ganttInstance = new Gantt('#gantt', tasks, {
      view_mode:   'Week',
      date_format: 'YYYY-MM-DD',
      bar_height:  28,
      padding:     18,
      scroll_to:   'today',
    });

    // Frappe v0.6.1 sometimes miscalculates gantt_end when dates span
    // multiple years. Override with the true max and force a re-render.
    const trueMaxEnd = tasks.reduce(
      (max, t) => new Date(t.end) > max ? new Date(t.end) : max,
      new Date(0)
    );
    if (ganttInstance.gantt_end < trueMaxEnd) {
      ganttInstance.gantt_end = trueMaxEnd;
      ganttInstance.render();
    }

    buildLeftPanel();
    syncScroll();
    initDragScroll();

  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = `Could not load project data: ${err.message}`;
    errorEl.classList.remove('hidden');
  }
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+d}`;
}

function daysBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86_400_000);
}

function buildLeftPanel() {
  const panel = document.getElementById('gantt-left-panel');
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'lp-header';
  header.innerHTML = `
    <span class="lp-name">Deliverable</span>
    <span class="lp-date">Start</span>
    <span class="lp-date">End</span>
    <span class="lp-days">Days</span>
  `;
  panel.appendChild(header);

  tasks.forEach(task => {
    const days = daysBetween(task.start, task.end);
    const row  = document.createElement('div');
    row.className  = `lp-row ${task.custom_class}`;
    row.dataset.id = task.id;
    row.innerHTML  = `
      <span class="lp-name" title="${task.name}">${task.name}</span>
      <span class="lp-date">${formatDate(task.start)}</span>
      <span class="lp-date">${formatDate(task.end)}</span>
      <span class="lp-days">${days}d</span>
    `;
    row.addEventListener('click', () => scrollToBar(task.id));
    panel.appendChild(row);
  });
}

function scrollToBar(taskId) {
  const inner = document.querySelector('#gantt-container .gantt-container');
  if (!inner) return;

  const barWrapper = inner.querySelector(`.bar-wrapper[data-id="${taskId}"]`);
  if (!barWrapper) return;

  const bar = barWrapper.querySelector('.bar');
  if (!bar) return;

  const x = parseFloat(bar.getAttribute('x'));
  const width = parseFloat(bar.getAttribute('width'));
  const targetScrollLeft = x + width / 2 - inner.clientWidth / 2;

  inner.scrollTo({ left: Math.max(0, targetScrollLeft), behavior: 'smooth' });
}

function syncScroll() {
  const outer    = document.getElementById('gantt-container');
  const inner    = outer.querySelector('.gantt-container');
  const leftPanel = document.getElementById('gantt-left-panel');
  inner.addEventListener('scroll', () => {
    leftPanel.scrollTop = inner.scrollTop;
  });
}

function initDragScroll() {
  const outer = document.getElementById('gantt-container');
  const inner = outer.querySelector('.gantt-container');
  let isDragging = false;
  let lastX, lastY;

  outer.addEventListener('mousedown', e => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    outer.classList.add('dragging');
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    inner.scrollLeft += lastX - e.clientX;
    inner.scrollTop  += lastY - e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    outer.classList.remove('dragging');
  });
}


function applyHighlights(highlights) {
  if (!ganttInstance || !Array.isArray(highlights)) return;

  const set     = new Set(highlights.map(h => h.toLowerCase().trim()));
  const wrapper = document.getElementById('gantt-wrapper');

  tasks = tasks.map(t => ({
    ...t,
    custom_class: set.has(t.name.toLowerCase().trim()) ? 'bar-highlight' : 'bar-default',
  }));

  ganttInstance.refresh(tasks);
  buildLeftPanel();

  wrapper.classList.toggle('has-highlights', highlights.length > 0);
}

function initViewControls() {
  document.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!ganttInstance) return;
      document.querySelectorAll('.btn-view').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ganttInstance.change_view_mode(btn.dataset.mode);
    });
  });
}

// ── View switch ───────────────────────────────────────────────────────────────

function switchView(name) {
  const ganttView    = document.getElementById('gantt-view');
  const dashboardView = document.getElementById('dashboard-view');
  const viewControls = document.getElementById('gantt-view-controls');

  document.querySelectorAll('.btn-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === name)
  );

  if (name === 'dashboard') {
    ganttView.classList.add('hidden');
    viewControls.classList.add('hidden');
    dashboardView.classList.remove('hidden');
  } else {
    dashboardView.classList.add('hidden');
    viewControls.classList.remove('hidden');
    ganttView.classList.remove('hidden');
  }
}

function renderDashboardPanel(data) {
  const emptyEl   = document.getElementById('db-empty');
  const contentEl = document.getElementById('db-content');

  contentEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'db-header';
  header.innerHTML = `
    <div class="db-title">${data.title || 'Dashboard de Riesgos'}</div>
    ${data.answer ? `<div class="db-subtitle">${data.answer}</div>` : ''}
  `;
  contentEl.appendChild(header);

  if (data.data?.kpis?.length) {
    const grid = document.createElement('div');
    grid.className = 'db-kpis';
    data.data.kpis.forEach(kpi => {
      const card = document.createElement('div');
      card.className = 'db-kpi-card';
      card.innerHTML = `
        <span class="db-kpi-value" style="color:${kpi.color}">${kpi.value}</span>
        <span class="db-kpi-label">${kpi.label}</span>
      `;
      grid.appendChild(card);
    });
    contentEl.appendChild(grid);
  }

  if (data.data?.charts?.length) {
    const chartsGrid = document.createElement('div');
    chartsGrid.className = 'db-charts';

    data.data.charts.forEach(chartDef => {
      const wrap = document.createElement('div');
      wrap.className = 'db-chart';

      const title = document.createElement('div');
      title.className = 'db-chart-title';
      title.textContent = chartDef.title;
      wrap.appendChild(title);

      const canvas = document.createElement('canvas');
      canvas.id = `db-${chartDef.id}-${Date.now()}`;
      wrap.appendChild(canvas);
      chartsGrid.appendChild(wrap);

      const bgColors = chartDef.colors
        ? chartDef.colors
        : Array(chartDef.labels.length).fill(chartDef.color || '#5b8dee');

      new Chart(canvas, {
        type: chartDef.type,
        data: {
          labels: chartDef.labels,
          datasets: [{
            data:            chartDef.values,
            backgroundColor: bgColors,
            borderColor:     chartDef.type === 'bar' ? 'transparent' : '#1a1d27',
            borderWidth:     chartDef.type === 'bar' ? 0 : 2,
          }]
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: chartDef.type !== 'bar',
              labels:  { color: '#8892a4', font: { size: 11 }, boxWidth: 12 },
            }
          },
          scales: chartDef.type === 'bar' ? {
            x: { ticks: { color: '#8892a4', font: { size: 10 } }, grid: { color: '#2e3248' } },
            y: { ticks: { color: '#8892a4', font: { size: 10 } }, grid: { color: '#2e3248' }, beginAtZero: true },
          } : undefined,
        }
      });
    });

    contentEl.appendChild(chartsGrid);
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
}

function initViewTabs() {
  document.querySelectorAll('.btn-tab').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.tab))
  );
}

// ── Init ──────────────────────────────────────────────────────────────────────
// Skipped when loaded under Node/CommonJS (unit tests) — only runs in the browser.
if (typeof module === 'undefined') {
  initViewControls();
  initViewTabs();
  loadGantt();
}

// ── Exports (for Vitest under Node; no-op in the browser, where `module` is undefined) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeDate,
    loadGantt,
    formatDate,
    daysBetween,
    buildLeftPanel,
    scrollToBar,
    syncScroll,
    initDragScroll,
    applyHighlights,
    initViewControls,
    switchView,
    renderDashboardPanel,
    initViewTabs,
  };
}

