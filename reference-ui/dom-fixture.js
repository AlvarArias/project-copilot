// Minimal DOM fixture mirroring the elements gantt.js / chat.js expect to exist
// in index.html. Needed because both modules read/query these elements at
// require-time (chat.js) or when their functions run (gantt.js).
function installDom() {
  document.body.innerHTML = `
    <div class="section-header">
      <div class="section-tabs">
        <button class="btn-tab active" data-tab="gantt">Gantt</button>
        <button class="btn-tab" data-tab="dashboard">Dashboard</button>
      </div>
      <div class="view-controls" id="gantt-view-controls">
        <button class="btn-view" data-mode="Day">Day</button>
        <button class="btn-view active" data-mode="Week">Week</button>
        <button class="btn-view" data-mode="Month">Month</button>
      </div>
    </div>

    <div id="gantt-view">
      <div id="gantt-loading" class="status-state">Loading…</div>
      <div id="gantt-error" class="status-state error hidden"></div>
      <div id="gantt-wrapper" class="hidden">
        <div id="gantt-left-panel"></div>
        <div id="gantt-container">
          <svg id="gantt"></svg>
        </div>
      </div>
    </div>

    <div id="dashboard-view" class="hidden">
      <div id="db-empty" class="status-state">empty</div>
      <div id="db-content" class="hidden"></div>
    </div>

    <div class="chat-messages" id="chat-messages"></div>
    <textarea id="chat-input"></textarea>
    <button id="chat-send"></button>
    <span id="chat-status" class="chat-status">Ready</span>
    <div class="chat-quick-actions">
      <button class="btn-quick" data-cmd="dashboard screen">Dashboard</button>
      <button class="btn-quick" data-cmd="show gantt">Gantt</button>
    </div>
  `;
}

export { installDom };
