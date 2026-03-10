// ── OnDeckLLM Frontend ──

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

let providerMeta = {};
let providerData = {};
let taskRoutes = {};
let profiles = {};
let activeProfile = null;
let discoveredProviders = [];

// ── Init ──

async function init() {
  setupNavigation();
  await Promise.all([
    loadProviders(),
    loadRoutes(),
    loadProfiles(),
    loadDiscovery()
  ]);
  renderWelcomeBanner();
  renderProviders();
  renderCostTracker();
  renderCompare();
  renderRouter();
  renderOllamaModels();
  renderProfiles();
  renderSupport();
  // Auto-test all configured providers in background
  autoTestProviders();
  // Auto-refresh cost tracker every 60s
  setInterval(() => {
    if ($('#page-costs').classList.contains('active')) {
      refreshCostData();
    }
  }, 60000);
}

// ── Navigation ──

function setupNavigation() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      $$('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      $$('.page').forEach(p => p.classList.remove('active'));
      $(`#page-${page}`).classList.add('active');
    });
  });
}

// ── API Helpers ──

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

// ── Toast ──

function toast(message, type = 'info') {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 300ms ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ── Discovery ──

async function loadDiscovery() {
  const data = await api('/discovery');
  discoveredProviders = data.discovered || [];
}

function renderWelcomeBanner() {
  const banner = $('#welcome-banner');
  // Count configured providers
  const configured = Object.values(providerData).filter(p => p.status === 'active' || p.status === 'configured');

  if (configured.length === 0) {
    banner.innerHTML = '';
    return;
  }

  banner.innerHTML = `
    <div class="welcome-banner">
      <div class="banner-icon">\u2714\uFE0F</div>
      <div class="banner-text">
        <h3>Found ${configured.length} provider${configured.length !== 1 ? 's' : ''} configured</h3>
        <p>${discoveredProviders.length > 0 ? `Auto-discovered: ${discoveredProviders.join(', ')}` : 'Ready to route requests'}</p>
      </div>
      <div class="banner-providers">
        ${configured.map(p => `
          <span class="provider-chip">
            <span class="chip-dot" style="background:${p.color}"></span>
            ${p.name}
          </span>
        `).join('')}
      </div>
      <button class="banner-dismiss" onclick="this.closest('.welcome-banner').remove()">&times;</button>
    </div>
  `;
}

// ══════════════════════════════════════
// ── Provider Hub
// ══════════════════════════════════════

async function loadProviders() {
  [providerMeta, providerData] = await Promise.all([
    api('/providers/meta'),
    api('/providers')
  ]);
}

function renderProviders() {
  const page = $('#page-providers');
  page.innerHTML = `
    <div class="page-header">
      <h1>Provider Hub</h1>
      <p>Manage API keys and connections for your LLM providers</p>
    </div>
    <div class="card-grid" id="provider-grid"></div>
  `;

  const grid = $('#provider-grid');
  for (const [id, info] of Object.entries(providerData)) {
    grid.appendChild(createProviderCard(id, info));
  }
}

function getHealthIndicator(info) {
  if (!info.configured) return '';
  if (info.lastTestOk === null) {
    return '<span class="health-dot health-yellow" title="Not tested yet"></span>';
  }
  if (!info.lastTestOk) {
    return `<span class="health-dot health-red" title="Last test failed"></span>`;
  }
  if (info.lastLatency > 2000) {
    return `<span class="health-dot health-yellow" title="Slow: ${info.lastLatency}ms"></span> <span class="health-latency slow">${info.lastLatency}ms</span>`;
  }
  return `<span class="health-dot health-green" title="Healthy: ${info.lastLatency}ms"></span> <span class="health-latency">${info.lastLatency}ms</span>`;
}

function createProviderCard(id, info) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = `provider-${id}`;

  const statusClass = info.status || 'unconfigured';
  const statusLabel = {
    active: 'Active', configured: 'Configured', error: 'Error', unconfigured: 'Not Set Up'
  }[statusClass] || statusClass;

  const discoveredBadge = info.autoDiscovered ? '<span class="auto-discovered-badge">AUTO</span>' : '';
  const healthIndicator = getHealthIndicator(info);

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">
        <div class="provider-dot" style="background:${info.color};box-shadow:0 0 6px ${info.color}44"></div>
        <h3>${info.name}</h3>
        ${info.local ? '<span class="model-tag">LOCAL</span>' : ''}
        ${discoveredBadge}
      </div>
      <div class="card-status-area">
        <span class="health-indicator">${healthIndicator}</span>
        <span class="status-badge ${statusClass}">${statusClass === 'active' ? '\u2714 ' : ''}${statusLabel}</span>
      </div>
    </div>
    <div class="provider-config">
      ${info.local ? renderLocalProviderForm(id, info) : renderCloudProviderForm(id, info)}
    </div>
    <div class="model-tags">
      ${info.models.map(m => `<span class="model-tag">${m}</span>`).join('')}
    </div>
  `;
  return card;
}

function renderCloudProviderForm(id, info) {
  return `
    <div class="input-group">
      <label>API Key</label>
      <div class="input-wrapper">
        <input type="password" id="key-${id}" placeholder="sk-..." value="${info.apiKey || ''}" />
        <button class="toggle-vis" onclick="toggleKeyVis('${id}')">&#9673;</button>
      </div>
    </div>
    <div class="btn-group">
      <button class="btn btn-primary btn-sm" onclick="saveProvider('${id}')">Save Key</button>
      <button class="btn btn-success btn-sm" onclick="testProvider('${id}')">Test</button>
      ${info.configured ? `<button class="btn btn-danger btn-sm" onclick="removeProvider('${id}')">Remove</button>` : ''}
    </div>
  `;
}

function renderLocalProviderForm(id, info) {
  return `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
      Local provider \u2014 no API key needed. Make sure the service is running.
    </p>
    <div class="btn-group">
      <button class="btn btn-success btn-sm" onclick="testProvider('${id}')">Test Connection</button>
    </div>
  `;
}

window.toggleKeyVis = function(id) {
  const input = $(`#key-${id}`);
  input.type = input.type === 'password' ? 'text' : 'password';
};

window.saveProvider = async function(id) {
  const input = $(`#key-${id}`);
  const key = input.value.trim();
  if (!key) return toast('Enter an API key', 'error');
  await api(`/providers/${id}`, { method: 'POST', body: { apiKey: key } });
  toast(`${providerData[id].name} key saved`, 'success');
  await loadProviders();
  renderProviders();
  renderWelcomeBanner();
};

window.testProvider = async function(id) {
  const card = $(`#provider-${id}`);
  const btn = card.querySelector('.btn-success');
  const origText = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Testing...';
  btn.disabled = true;

  const result = await api(`/providers/${id}/test`, { method: 'POST' });

  btn.textContent = origText;
  btn.disabled = false;

  if (result.ok) {
    toast(`${providerData[id].name}: Connection successful!`, 'success');
  } else {
    toast(`${providerData[id].name}: ${result.message}`, 'error');
  }
  await loadProviders();
  renderProviders();
  renderWelcomeBanner();
  // Refresh router to pick up any new models
  renderRouter();
};

window.removeProvider = async function(id) {
  if (!confirm(`Remove ${providerData[id].name} API key?`)) return;
  await api(`/providers/${id}`, { method: 'DELETE' });
  toast(`${providerData[id].name} removed`, 'info');
  await loadProviders();
  renderProviders();
  renderWelcomeBanner();
};

// ══════════════════════════════════════
// ── Cost Tracker
// ══════════════════════════════════════

let costSummary = null;
let costChart = null;

async function loadCostSummary() {
  costSummary = await api('/usage/summary?range=all');
}

function formatCost(val) {
  if (val === 0) return '$0.00';
  if (val < 0.01) return '<$0.01';
  return '$' + val.toFixed(2);
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function costColorClass(dailyCost) {
  if (dailyCost > 5) return 'cost-red';
  if (dailyCost > 1) return 'cost-yellow';
  return 'cost-green';
}

function renderCostTracker() {
  const page = $('#page-costs');
  page.innerHTML = `
    <div class="page-header">
      <h1>Cost Tracker</h1>
      <p>Track LLM spending across all providers</p>
    </div>
    <div class="cost-summary-cards" id="cost-summary-cards">
      <div class="cost-card"><div class="cost-card-label">Today</div><div class="cost-card-value" id="cost-today">--</div></div>
      <div class="cost-card"><div class="cost-card-label">This Week</div><div class="cost-card-value" id="cost-week">--</div></div>
      <div class="cost-card"><div class="cost-card-label">This Month</div><div class="cost-card-value" id="cost-month">--</div></div>
      <div class="cost-card"><div class="cost-card-label">All Time</div><div class="cost-card-value" id="cost-all">--</div></div>
    </div>
    <div class="cost-chart-container">
      <h3>Daily Spend (Last 30 Days)</h3>
      <div class="cost-chart-wrapper">
        <canvas id="cost-chart"></canvas>
      </div>
    </div>
    <div class="cost-tables-row">
      <div class="cost-table-section">
        <h3>By Provider</h3>
        <div id="cost-provider-table"></div>
      </div>
      <div class="cost-table-section">
        <h3>By Model</h3>
        <div id="cost-model-table"></div>
      </div>
    </div>
  `;

  refreshCostData();
}

async function refreshCostData() {
  await loadCostSummary();
  if (!costSummary) return;

  // Summary cards
  const todayCostVal = costSummary.todayCost || 0;
  $('#cost-today').textContent = formatCost(todayCostVal);
  $('#cost-today').className = `cost-card-value ${costColorClass(todayCostVal)}`;
  $('#cost-week').textContent = formatCost(costSummary.weekCost || 0);
  $('#cost-month').textContent = formatCost(costSummary.monthCost || 0);
  $('#cost-all').textContent = formatCost(costSummary.allCost || 0);

  // Chart
  renderCostChart();

  // Provider table
  renderProviderCostTable();

  // Model table
  renderModelCostTable();
}

function renderCostChart() {
  const canvas = document.getElementById('cost-chart');
  if (!canvas || !costSummary?.daily) return;

  const labels = costSummary.daily.map(d => {
    const date = new Date(d.date + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const data = costSummary.daily.map(d => d.cost);

  const colors = data.map(v => {
    if (v > 5) return 'rgba(248, 81, 73, 0.8)';
    if (v > 1) return 'rgba(210, 153, 34, 0.8)';
    return 'rgba(63, 185, 80, 0.8)';
  });

  if (costChart) {
    costChart.destroy();
  }

  if (typeof Chart !== 'undefined') {
    costChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => '$' + ctx.parsed.y.toFixed(4)
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(48,54,61,0.5)' },
            ticks: { color: '#8b949e', font: { size: 10 }, maxRotation: 45 }
          },
          y: {
            grid: { color: 'rgba(48,54,61,0.5)' },
            ticks: { color: '#8b949e', callback: v => '$' + v.toFixed(2) },
            beginAtZero: true
          }
        }
      }
    });
  } else {
    // CSS bars fallback
    const wrapper = canvas.parentElement;
    const maxVal = Math.max(...data, 0.01);
    wrapper.innerHTML = `<div class="css-chart">${data.map((v, i) => `
      <div class="css-bar-col" title="${labels[i]}: $${v.toFixed(4)}">
        <div class="css-bar" style="height:${(v/maxVal)*100}%;background:${colors[i]}"></div>
        <span class="css-bar-label">${labels[i].split(' ')[1] || ''}</span>
      </div>
    `).join('')}</div>`;
  }
}

function renderProviderCostTable() {
  const container = $('#cost-provider-table');
  const providers = Object.entries(costSummary.byProvider || {}).sort((a, b) => b[1].cost - a[1].cost);

  if (providers.length === 0) {
    container.innerHTML = '<div class="cost-empty">No usage data yet</div>';
    return;
  }

  container.innerHTML = `
    <table class="cost-table">
      <thead>
        <tr><th>Provider</th><th>Requests</th><th>Tokens</th><th>Cost</th><th>Avg Latency</th></tr>
      </thead>
      <tbody>
        ${providers.map(([name, d]) => {
          const color = providerData[name]?.color || '#888';
          const displayName = providerData[name]?.name || name;
          return `<tr>
            <td><span class="prov-dot" style="background:${color}"></span> ${displayName}</td>
            <td>${d.requests}</td>
            <td>${formatTokens(d.inputTokens + d.outputTokens)}</td>
            <td>${formatCost(d.cost)}</td>
            <td>${d.avgLatency}ms</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderModelCostTable() {
  const container = $('#cost-model-table');
  const models = Object.entries(costSummary.byModel || {}).sort((a, b) => b[1].cost - a[1].cost);

  if (models.length === 0) {
    container.innerHTML = '<div class="cost-empty">No usage data yet</div>';
    return;
  }

  container.innerHTML = `
    <table class="cost-table">
      <thead>
        <tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr>
      </thead>
      <tbody>
        ${models.map(([name, d]) => `<tr>
          <td class="cost-model-name">${name}</td>
          <td>${d.requests}</td>
          <td>${formatTokens(d.inputTokens + d.outputTokens)}</td>
          <td>${formatCost(d.cost)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

// ══════════════════════════════════════
// ── A/B Compare
// ══════════════════════════════════════

let compareRunning = false;

function getAvailableModels() {
  const models = [];
  for (const [pid, prov] of Object.entries(providerData)) {
    if (!prov.configured) continue;
    for (const m of prov.models) {
      models.push({ provider: pid, model: m, label: `${prov.name} / ${m}`, color: prov.color });
    }
  }
  return models;
}

function renderCompare() {
  const page = $('#page-compare');
  const models = getAvailableModels();

  const modelOptions = models.map(m =>
    `<option value="${m.provider}/${m.model}">${m.label}</option>`
  ).join('');

  page.innerHTML = `
    <div class="page-header">
      <h1>A/B Compare</h1>
      <p>Send the same prompt to two models and compare results side-by-side</p>
    </div>
    <div class="compare-controls">
      <div class="compare-prompt-area">
        <label>Prompt</label>
        <textarea id="compare-prompt" placeholder="Enter your prompt here..." rows="4"></textarea>
      </div>
      <div class="compare-selectors">
        <div class="compare-selector">
          <label>Model A</label>
          <select id="compare-model-a">${modelOptions}</select>
        </div>
        <div class="compare-vs">VS</div>
        <div class="compare-selector">
          <label>Model B</label>
          <select id="compare-model-b">${models.length > 1 ? modelOptions.replace('selected', '') : modelOptions}</select>
        </div>
      </div>
      <div class="compare-options">
        <label>Max Tokens: <span id="compare-tokens-val">1024</span></label>
        <input type="range" id="compare-tokens" min="256" max="4096" step="256" value="1024" oninput="$('#compare-tokens-val').textContent=this.value">
      </div>
      <button class="btn btn-primary compare-btn" id="compare-go" onclick="runCompare()">Compare</button>
    </div>
    <div id="compare-results"></div>
  `;

  // Select second option for model B if available
  if (models.length > 1) {
    $('#compare-model-b').selectedIndex = 1;
  }
}

window.runCompare = async function() {
  if (compareRunning) return;

  const prompt = $('#compare-prompt').value.trim();
  if (!prompt) return toast('Enter a prompt', 'error');

  const modelA = $('#compare-model-a').value;
  const modelB = $('#compare-model-b').value;
  const maxTokens = parseInt($('#compare-tokens').value, 10);

  compareRunning = true;
  const btn = $('#compare-go');
  btn.innerHTML = '<span class="spinner"></span> Comparing...';
  btn.disabled = true;

  const resultsDiv = $('#compare-results');
  resultsDiv.innerHTML = '<div class="compare-loading">Sending prompt to both models...</div>';

  try {
    const result = await api('/compare', {
      method: 'POST',
      body: { prompt, modelA, modelB, maxTokens }
    });

    renderCompareResults(modelA, modelB, result);
  } catch (err) {
    resultsDiv.innerHTML = `<div class="cost-empty">Error: ${err.message}</div>`;
  } finally {
    compareRunning = false;
    btn.textContent = 'Compare';
    btn.disabled = false;
  }
};

function renderCompareResults(modelA, modelB, result) {
  const div = $('#compare-results');

  const a = result.a || {};
  const b = result.b || {};

  // Winner badges
  const aFaster = !a.error && !b.error && a.latencyMs < b.latencyMs;
  const bFaster = !a.error && !b.error && b.latencyMs < a.latencyMs;
  const aCheaper = !a.error && !b.error && a.cost < b.cost;
  const bCheaper = !a.error && !b.error && b.cost < a.cost;
  const aLonger = !a.error && !b.error && (a.response?.length || 0) > (b.response?.length || 0);
  const bLonger = !a.error && !b.error && (b.response?.length || 0) > (a.response?.length || 0);

  function renderSide(label, data, faster, cheaper, longer) {
    if (data.error) {
      return `
        <div class="compare-result-card compare-error">
          <div class="compare-result-header"><h3>${label}</h3></div>
          <div class="compare-result-error">Error: ${data.error}</div>
        </div>
      `;
    }

    const badges = [];
    if (faster) badges.push('<span class="compare-badge badge-fast">&#x26A1; Faster</span>');
    if (cheaper) badges.push('<span class="compare-badge badge-cheap">&#x1F4B0; Cheaper</span>');
    if (longer) badges.push('<span class="compare-badge badge-longer">&#x1F4DD; Longer</span>');

    return `
      <div class="compare-result-card">
        <div class="compare-result-header">
          <h3>${label}</h3>
          <div class="compare-badges">${badges.join('')}</div>
        </div>
        <div class="compare-response-text">${escapeHtml(data.response || '')}</div>
        <div class="compare-metrics">
          <div class="compare-metric"><span class="compare-metric-label">Tokens In</span><span>${data.inputTokens || 0}</span></div>
          <div class="compare-metric"><span class="compare-metric-label">Tokens Out</span><span>${data.outputTokens || 0}</span></div>
          <div class="compare-metric"><span class="compare-metric-label">Latency</span><span>${data.latencyMs || 0}ms</span></div>
          <div class="compare-metric"><span class="compare-metric-label">Cost</span><span>${formatCost(data.cost || 0)}</span></div>
        </div>
      </div>
    `;
  }

  const [provA, ...modA] = modelA.split('/');
  const [provB, ...modB] = modelB.split('/');
  const labelA = `${providerData[provA]?.name || provA} / ${modA.join('/')}`;
  const labelB = `${providerData[provB]?.name || provB} / ${modB.join('/')}`;

  div.innerHTML = `
    <div class="compare-results-grid">
      ${renderSide(labelA, a, aFaster, aCheaper, aLonger)}
      ${renderSide(labelB, b, bFaster, bCheaper, bLonger)}
    </div>
  `;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ══════════════════════════════════════
// ── Batting Order (Task Router)
// ══════════════════════════════════════

const TASK_TYPES = {
  chat: { icon: '\u{1F4AC}', label: 'Chat / General', desc: 'Conversational AI, Q&A, summarization' },
  coding: { icon: '\u{1F4BB}', label: 'Coding', desc: 'Code generation, review, debugging' },
  images: { icon: '\u{1F5BC}\uFE0F', label: 'Images', desc: 'Image generation and editing' },
  video: { icon: '\u{1F3A5}', label: 'Video', desc: 'Video generation and processing' },
  research: { icon: '\u{1F50D}', label: 'Research / RAG', desc: 'Deep research, retrieval, analysis' },
  data: { icon: '\u{1F4CA}', label: 'Data / Analysis', desc: 'Data processing, charts, analytics' }
};

async function loadRoutes() {
  taskRoutes = await api('/routes');
}

function renderRouter() {
  const page = $('#page-router');
  page.innerHTML = `
    <div class="page-header">
      <h1>Batting Order</h1>
      <p>Set your model lineup per task type. #1 is your primary \u2014 the rest are fallbacks in order.
        <span class="sync-badge">\u21C4 Syncs to OpenClaw</span>
      </p>
    </div>
    <div id="task-sections"></div>
  `;

  const container = $('#task-sections');
  for (const [taskId, meta] of Object.entries(TASK_TYPES)) {
    container.appendChild(createTaskSection(taskId, meta));
  }
}

function createTaskSection(taskId, meta) {
  const section = document.createElement('div');
  section.className = 'task-section';

  const routes = taskRoutes[taskId] || [];

  section.innerHTML = `
    <div class="task-header">
      <span class="task-icon">${meta.icon}</span>
      <h3>${meta.label}</h3>
      <span class="task-desc">${meta.desc}</span>
    </div>
    <div class="lineup-card">
      <div class="lineup-card-header">
        <span class="lineup-title">LINEUP</span>
        <span>${routes.length} model${routes.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="lineup-list" data-task="${taskId}">
        ${routes.length === 0 ? '<div class="empty-state">No models in the lineup \u2014 add one to get started</div>' : ''}
        ${routes.map((r, i) => renderLineupEntry(taskId, r, i, routes.length)).join('')}
      </div>
      <div class="lineup-add-btn">
        <button class="btn" onclick="openAddModelModal('${taskId}')">+ Add Model to Lineup</button>
      </div>
    </div>
  `;

  setupDragDrop(section.querySelector('.lineup-list'), taskId);

  return section;
}

function getRankLabel(index) {
  if (index === 0) return 'Primary';
  return `Fallback #${index}`;
}

function getRankClass(index) {
  if (index === 0) return 'rank-1';
  if (index === 1) return 'rank-2';
  if (index === 2) return 'rank-3';
  return 'rank-n';
}

function renderLineupEntry(taskId, route, index, total) {
  const provColor = providerData[route.provider]?.color || '#888';
  const provName = providerData[route.provider]?.name || route.provider;
  const rankClass = getRankClass(index);
  const roleClass = index === 0 ? 'role-primary' : 'role-fallback';
  const roleLabel = index === 0 ? 'PRIMARY' : `FB #${index}`;

  return `
    <div class="lineup-entry" draggable="true" data-index="${index}">
      <span class="drag-handle">\u2982</span>
      <span class="rank-badge ${rankClass}">${index + 1}</span>
      <span class="lineup-provider">
        <span class="prov-dot" style="background:${provColor};box-shadow:0 0 4px ${provColor}66"></span>
        <span class="prov-name">${provName}</span>
      </span>
      <span class="lineup-model">${route.model}</span>
      <span class="lineup-role ${roleClass}">${roleLabel}</span>
      <button class="lineup-remove" onclick="removeRoute('${taskId}', ${index})">&times;</button>
    </div>
  `;
}

function setupDragDrop(list, taskId) {
  let dragIndex = null;

  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.lineup-entry');
    if (!item) return;
    dragIndex = parseInt(item.dataset.index);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', (e) => {
    const item = e.target.closest('.lineup-entry');
    if (item) item.classList.remove('dragging');
    list.classList.remove('drag-over');
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    list.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
  });

  list.addEventListener('dragleave', () => {
    list.classList.remove('drag-over');
  });

  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    list.classList.remove('drag-over');

    const items = $$('.lineup-entry', list);
    let dropIndex = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        dropIndex = i;
        break;
      }
    }

    if (dragIndex !== null && dragIndex !== dropIndex) {
      const routes = taskRoutes[taskId] || [];
      const [moved] = routes.splice(dragIndex, 1);
      routes.splice(dropIndex, 0, moved);
      taskRoutes[taskId] = routes;
      await api('/routes', { method: 'PUT', body: taskRoutes });
      renderRouter();
      toast('Lineup reordered', 'success');
    }
    dragIndex = null;
  });
}

// ── Add Model Modal ──

window.openAddModelModal = function(taskId) {
  const existing = (taskRoutes[taskId] || []).map(r => `${r.provider}:${r.model}`);
  const configured = Object.entries(providerData).filter(([, p]) => p.configured);

  const modalRoot = $('#modal-root');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h2>Add Model to ${TASK_TYPES[taskId].label} Lineup</h2>
          <p>Select from your configured providers</p>
        </div>
        <div class="modal-body">
          ${configured.length === 0 ? '<div class="empty-state">No providers configured. Go to Provider Hub first.</div>' : ''}
          ${configured.map(([pid, prov]) => `
            <div class="modal-provider-section">
              <div class="modal-provider-header">
                <span class="prov-dot" style="background:${prov.color}"></span>
                ${prov.name}
              </div>
              <div class="modal-model-list">
                ${prov.models.map(m => {
                  const key = `${pid}:${m}`;
                  const added = existing.includes(key);
                  return `
                    <div class="modal-model-item${added ? ' already-added' : ''}" onclick="${added ? '' : `selectModelForLineup('${taskId}','${pid}','${m}')`}">
                      ${added ? '<span class="model-check">\u2714</span>' : '<span style="width:14px"></span>'}
                      ${m}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `;
};

window.selectModelForLineup = async function(taskId, provider, model) {
  if (!taskRoutes[taskId]) taskRoutes[taskId] = [];
  taskRoutes[taskId].push({ provider, model });
  await api('/routes', { method: 'PUT', body: taskRoutes });
  closeModal();
  renderRouter();
  toast(`Added ${model} to ${TASK_TYPES[taskId].label} lineup`, 'success');
};

window.closeModal = function() {
  $('#modal-root').innerHTML = '';
};

window.removeRoute = async function(taskId, index) {
  const route = taskRoutes[taskId][index];
  taskRoutes[taskId].splice(index, 1);
  await api('/routes', { method: 'PUT', body: taskRoutes });
  renderRouter();
  toast(`Removed ${route.model} from lineup`, 'info');
};

// ══════════════════════════════════════
// ── Profiles
// ══════════════════════════════════════

async function loadProfiles() {
  const data = await api('/profiles');
  profiles = data.profiles;
  activeProfile = data.active;
}

function renderProfiles() {
  const page = $('#page-profiles');
  page.innerHTML = `
    <div class="page-header">
      <h1>Profiles</h1>
      <p>One-click routing presets. Activating a profile reconfigures all batting orders.</p>
    </div>
    <div class="profile-grid" id="profile-grid"></div>
  `;

  const grid = $('#profile-grid');
  for (const [id, profile] of Object.entries(profiles)) {
    grid.appendChild(createProfileCard(id, profile));
  }
}

function createProfileCard(id, profile) {
  const card = document.createElement('div');
  card.className = `profile-card${activeProfile === id ? ' active' : ''}`;
  card.onclick = () => activateProfile(id);

  const models = new Set();
  for (const routes of Object.values(profile.taskRoutes || {})) {
    for (const r of routes) {
      models.add(r.model);
    }
  }

  card.innerHTML = `
    <div class="profile-icon">${profile.icon}</div>
    <h3>${profile.name}</h3>
    <p>${profile.description}</p>
    <div class="profile-models">
      ${[...models].slice(0, 6).map(m => `<span class="model-tag">${m}</span>`).join('')}
      ${models.size > 6 ? `<span class="model-tag">+${models.size - 6} more</span>` : ''}
    </div>
  `;
  return card;
}

async function activateProfile(id) {
  const result = await api('/profiles/activate', { method: 'POST', body: { profileId: id } });
  if (result.ok) {
    activeProfile = id;
    taskRoutes = result.routes;
    renderProfiles();
    renderRouter();
    toast(`${profiles[id].name} profile activated \u2014 synced to OpenClaw`, 'success');
  }
}

// ══════════════════════════════════════
// ── Support Page
// ══════════════════════════════════════

function renderSupport() {
  const page = $('#page-support');
  page.innerHTML = `
    <div class="page-header">
      <h1>Support</h1>
      <p>Get help, contribute, and connect with providers</p>
    </div>
    <div class="support-links">
      <a href="https://github.com/canonflip/ondeckllm" target="_blank" class="support-link-card">
        <span class="support-link-icon">&#9733;</span>
        <div>
          <h3>Star on GitHub</h3>
          <p>Show your support — star the repo</p>
        </div>
      </a>
      <a href="https://github.com/canonflip/ondeckllm/issues" target="_blank" class="support-link-card">
        <span class="support-link-icon">&#128027;</span>
        <div>
          <h3>Report Bugs</h3>
          <p>Found an issue? Let us know</p>
        </div>
      </a>
      <a href="https://buymeacoffee.com/canonflip" target="_blank" class="support-link-card">
        <span class="support-link-icon">&#9749;</span>
        <div>
          <h3>Buy Us a Coffee</h3>
          <p>Help fund development</p>
        </div>
      </a>
    </div>
    <div class="provider-getstarted-section">
      <h2>Get Started with a Provider</h2>
      <p>Don't have an API key yet? Sign up with one of these providers.</p>
      <div class="provider-getstarted-grid">
        ${renderProviderSignupCard('OpenAI', '#10a37f', 'https://platform.openai.com', 'GPT-4o, o3, DALL-E')}
        ${renderProviderSignupCard('Anthropic', '#d4a574', 'https://console.anthropic.com', 'Claude Opus, Sonnet, Haiku')}
        ${renderProviderSignupCard('Google AI', '#4285f4', 'https://aistudio.google.com', 'Gemini 2.0 Pro & Flash')}
        ${renderProviderSignupCard('Groq', '#f55036', 'https://groq.com', 'Ultra-fast inference')}
        ${renderProviderSignupCard('Mistral', '#ff7000', 'https://mistral.ai', 'Mistral Large, Codestral')}
        ${renderProviderSignupCard('DeepSeek', '#5b6ee1', 'https://deepseek.com', 'DeepSeek Chat & Coder')}
        ${renderProviderSignupCard('Together AI', '#6e56cf', 'https://together.ai', 'Open-source model hosting')}
        ${renderProviderSignupCard('Ollama', '#ffffff', 'https://ollama.com', 'Run models locally — free')}
        ${renderProviderSignupCard('OpenRouter', '#c084fc', 'https://openrouter.ai', 'Unified API for 100+ models')}
      </div>
    </div>
    <div class="support-footer">
      Built by <a href="https://canonflip.com" target="_blank">Canonflip</a>
    </div>
  `;
}

function renderProviderSignupCard(name, color, url, desc) {
  return `
    <a href="${url}" target="_blank" class="provider-signup-card">
      <span class="prov-dot" style="background:${color};box-shadow:0 0 6px ${color}66"></span>
      <div>
        <h4>${name}</h4>
        <p>${desc}</p>
      </div>
      <span class="signup-arrow">&#8594;</span>
    </a>
  `;
}

// ══════════════════════════════════════
// ── Auto Health Test
// ══════════════════════════════════════

async function autoTestProviders() {
  const hasConfigured = Object.values(providerData).some(p => p.configured);
  if (!hasConfigured) return;
  try {
    await api('/providers/test-all', { method: 'POST' });
    await loadProviders();
    renderProviders();
  } catch { /* silent background test */ }
}

// ══════════════════════════════════════
// ── Ollama Model Browser
// ══════════════════════════════════════

let ollamaInstalledModels = [];
let ollamaLibrary = [];
let ollamaSource = 'ollama';
let activePulls = {};

async function loadOllamaModels() {
  const [installed, library] = await Promise.all([
    api(`/ollama/models?source=${ollamaSource}`),
    api('/ollama/library')
  ]);
  ollamaInstalledModels = installed.models || [];
  ollamaLibrary = library.models || [];
}

let ollamaStatus = null;
let ollamaPacks = [];

async function loadOllamaStatus() {
  ollamaStatus = await api('/ollama/status');
}

async function loadOllamaPacks() {
  const data = await api('/ollama/packs');
  ollamaPacks = data.packs || [];
}

function renderOllamaModels() {
  const page = $('#page-ollama');

  // Check if remote-ollama is configured
  const remoteConfigured = providerData['remote-ollama']?.configured;
  const remoteUrl = providerData['remote-ollama']?.baseUrl || '';

  page.innerHTML = `
    <div class="page-header">
      <h1>Ollama Models</h1>
      <p>Browse, pull, and manage models on your Ollama instance</p>
    </div>
    <div id="ollama-wizard"></div>
    <div class="ollama-source-bar">
      <div class="ollama-source-tabs">
        <button class="ollama-tab${ollamaSource === 'ollama' ? ' active' : ''}" onclick="switchOllamaSource('ollama')">
          <span class="prov-dot" style="background:#fff"></span> Local Ollama
        </button>
        ${remoteConfigured ? `
          <button class="ollama-tab${ollamaSource === 'remote-ollama' ? ' active' : ''}" onclick="switchOllamaSource('remote-ollama')">
            <span class="prov-dot" style="background:#a78bfa"></span> Remote Ollama
          </button>
        ` : ''}
      </div>
      ${remoteConfigured && remoteUrl ? `<span class="ollama-source-url">${remoteUrl}</span>` : ''}
    </div>
    <div id="ollama-installed"></div>
    <div id="ollama-library"></div>
  `;

  // Load wizard data + models in parallel
  Promise.all([loadOllamaStatus(), loadOllamaPacks()]).then(() => {
    renderOllamaWizard();
  }).catch(() => {});

  loadOllamaModels().then(() => {
    renderOllamaInstalled();
    renderOllamaLibrary();
  }).catch(() => {
    $('#ollama-installed').innerHTML = `<div class="ollama-empty">Could not connect to Ollama. Make sure the service is running.</div>`;
  });
}

function renderOllamaWizard() {
  const container = $('#ollama-wizard');
  if (!container) return;

  if (!ollamaStatus) {
    container.innerHTML = '';
    return;
  }

  // Step 1: Status check
  if (!ollamaStatus.installed) {
    container.innerHTML = `
      <div class="wizard-section">
        <div class="wizard-header">
          <span class="wizard-step">1</span>
          <h3>Install Ollama</h3>
          <span class="wizard-status wizard-status-warn">Not Installed</span>
        </div>
        <p class="wizard-desc">Ollama lets you run LLMs locally. Install it first:</p>
        <div class="wizard-commands">
          <div class="wizard-cmd">
            <span class="wizard-cmd-label">macOS (Homebrew)</span>
            <div class="wizard-cmd-row">
              <code>brew install ollama</code>
              <button class="btn btn-sm btn-secondary" onclick="copyCmd('brew install ollama')">Copy</button>
            </div>
          </div>
          <div class="wizard-cmd">
            <span class="wizard-cmd-label">Linux / macOS (curl)</span>
            <div class="wizard-cmd-row">
              <code>curl -fsSL https://ollama.com/install.sh | sh</code>
              <button class="btn btn-sm btn-secondary" onclick="copyCmd('curl -fsSL https://ollama.com/install.sh | sh')">Copy</button>
            </div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="recheckOllamaStatus()" style="margin-top:12px">Re-check Status</button>
      </div>
    `;
    return;
  }

  if (!ollamaStatus.running) {
    container.innerHTML = `
      <div class="wizard-section">
        <div class="wizard-header">
          <span class="wizard-step">1</span>
          <h3>Start Ollama</h3>
          <span class="wizard-status wizard-status-warn">Installed but Not Running</span>
        </div>
        <p class="wizard-desc">Ollama is installed but the service isn't running. Start it:</p>
        <div class="wizard-commands">
          <div class="wizard-cmd">
            <div class="wizard-cmd-row">
              <code>ollama serve</code>
              <button class="btn btn-sm btn-secondary" onclick="copyCmd('ollama serve')">Copy</button>
            </div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="recheckOllamaStatus()" style="margin-top:12px">Re-check Status</button>
      </div>
    `;
    return;
  }

  // Step 2: Running — show packs
  const installedNames = new Set(ollamaStatus.modelsInstalled.map(m => m.split(':')[0]));
  const version = ollamaStatus.version ? ` v${ollamaStatus.version}` : '';

  container.innerHTML = `
    <div class="wizard-section wizard-section-ok">
      <div class="wizard-header">
        <span class="wizard-step wizard-step-ok">&#10003;</span>
        <h3>Ollama Running${version}</h3>
        <span class="wizard-status wizard-status-ok">${ollamaStatus.modelsInstalled.length} models installed</span>
      </div>
      <div class="wizard-packs">
        <h4>Starter Packs</h4>
        <p class="wizard-desc">Get started quickly with curated model bundles</p>
        <div class="wizard-pack-grid">
          ${ollamaPacks.map(pack => {
            const allInstalled = pack.models.every(m => installedNames.has(m.split(':')[0]));
            return `
              <div class="wizard-pack-card${allInstalled ? ' wizard-pack-done' : ''}">
                <div class="wizard-pack-icon">${pack.icon}</div>
                <h4>${pack.name}</h4>
                <p>${pack.description}</p>
                <div class="wizard-pack-models">
                  ${pack.models.map(m => `<span class="model-tag${installedNames.has(m.split(':')[0]) ? ' model-tag-installed' : ''}">${m}</span>`).join('')}
                </div>
                <div class="wizard-pack-meta">${pack.totalSize}</div>
                ${allInstalled
                  ? '<span class="ollama-installed-badge">All Installed</span>'
                  : `<button class="btn btn-primary btn-sm" onclick="installPack('${pack.id}')" id="pack-btn-${pack.id}">Install Pack</button>`
                }
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

window.copyCmd = function(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard', 'success'));
};

window.recheckOllamaStatus = async function() {
  await loadOllamaStatus();
  renderOllamaWizard();
  toast('Status refreshed', 'info');
};

window.installPack = async function(packId) {
  const btn = document.getElementById(`pack-btn-${packId}`);
  if (!btn) return;
  btn.innerHTML = '<span class="spinner"></span> Installing...';
  btn.disabled = true;

  try {
    const resp = await fetch('/api/ollama/install-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId, source: ollamaSource })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentModel = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'start') {
            currentModel = data.model;
            btn.innerHTML = `<span class="spinner"></span> ${data.model} (${data.index + 1}/${data.total})`;
          } else if (data.type === 'progress' && data.total && data.completed) {
            const pct = Math.round((data.completed / data.total) * 100);
            btn.innerHTML = `<span class="spinner"></span> ${currentModel} ${pct}%`;
          } else if (data.type === 'error') {
            toast(`Error pulling ${data.model}: ${data.error}`, 'error');
          } else if (data.type === 'complete') {
            toast('Pack installed successfully!', 'success');
          }
        } catch { /* skip */ }
      }
    }

    // Refresh everything
    await Promise.all([loadOllamaStatus(), loadOllamaModels()]);
    renderOllamaWizard();
    renderOllamaInstalled();
    renderOllamaLibrary();
  } catch (err) {
    toast(`Error installing pack: ${err.message}`, 'error');
    btn.textContent = 'Install Pack';
    btn.disabled = false;
  }
};

function formatBytes(bytes) {
  if (!bytes) return '—';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(1) + ' GB';
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(0) + ' MB';
}

function renderOllamaInstalled() {
  const container = $('#ollama-installed');
  container.innerHTML = `
    <div class="ollama-section-header">
      <h2>Installed Models</h2>
      <span class="ollama-count">${ollamaInstalledModels.length} model${ollamaInstalledModels.length !== 1 ? 's' : ''}</span>
      <button class="btn btn-sm btn-secondary" onclick="refreshOllamaModels()" style="margin-left:auto;">Refresh</button>
    </div>
    ${ollamaInstalledModels.length === 0 ? '<div class="ollama-empty">No models installed. Pull one from the library below.</div>' : ''}
    <div class="ollama-model-list">
      ${ollamaInstalledModels.map(m => `
        <div class="ollama-model-row">
          <div class="ollama-model-info">
            <span class="ollama-model-name">${m.name}</span>
            <span class="ollama-model-meta">${formatBytes(m.size)}</span>
            <span class="ollama-model-meta">${m.modified_at ? new Date(m.modified_at).toLocaleDateString() : ''}</span>
          </div>
          <button class="btn btn-sm btn-danger" onclick="deleteOllamaModel('${m.name}')">Delete</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOllamaLibrary() {
  const container = $('#ollama-library');
  const installedNames = new Set(ollamaInstalledModels.map(m => m.name.split(':')[0]));

  container.innerHTML = `
    <div class="ollama-section-header" style="margin-top:32px;">
      <h2>Model Library</h2>
      <span class="ollama-count">${ollamaLibrary.length} available</span>
    </div>
    <div class="ollama-model-list">
      ${ollamaLibrary.map(m => {
        const installed = installedNames.has(m.name);
        const pulling = activePulls[m.name];
        return `
          <div class="ollama-model-row">
            <div class="ollama-model-info">
              <span class="ollama-model-name">${m.name}</span>
              <span class="ollama-model-desc">${m.description}</span>
              <span class="ollama-model-meta">${m.size}${m.disk ? ` · <span class="ollama-disk-size">${m.disk}</span>` : ''}</span>
            </div>
            <div class="ollama-model-actions" id="ollama-action-${m.name.replace(/[^a-z0-9]/gi, '-')}">
              ${installed ? '<span class="ollama-installed-badge">Installed</span>' :
                pulling ? `<div class="ollama-progress"><div class="ollama-progress-bar" style="width:${pulling}%"></div><span>${pulling}%</span></div>` :
                `<button class="btn btn-sm btn-primary" onclick="pullOllamaModel('${m.name}')">Pull</button>`}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

window.switchOllamaSource = function(source) {
  ollamaSource = source;
  renderOllamaModels();
};

window.refreshOllamaModels = async function() {
  await loadOllamaModels();
  renderOllamaInstalled();
  renderOllamaLibrary();
  toast('Models refreshed', 'info');
};

window.deleteOllamaModel = async function(name) {
  if (!confirm(`Delete model "${name}"?`)) return;
  const result = await api('/ollama/delete', { method: 'DELETE', body: { model: name, source: ollamaSource } });
  if (result.ok) {
    toast(`Deleted ${name}`, 'success');
    await loadOllamaModels();
    renderOllamaInstalled();
    renderOllamaLibrary();
  } else {
    toast(`Error: ${result.error}`, 'error');
  }
};

window.pullOllamaModel = async function(name) {
  const safeId = name.replace(/[^a-z0-9]/gi, '-');
  const actionEl = document.getElementById(`ollama-action-${safeId}`);
  if (!actionEl) return;

  activePulls[name] = 0;
  actionEl.innerHTML = `<div class="ollama-progress"><div class="ollama-progress-bar" id="pull-bar-${safeId}" style="width:0%"></div><span id="pull-text-${safeId}">Starting...</span></div>`;

  try {
    const resp = await fetch('/api/ollama/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, source: ollamaSource })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) {
            toast(`Error pulling ${name}: ${data.error}`, 'error');
            delete activePulls[name];
            actionEl.innerHTML = `<button class="btn btn-sm btn-primary" onclick="pullOllamaModel('${name}')">Pull</button>`;
            return;
          }
          if (data.total && data.completed) {
            const pct = Math.round((data.completed / data.total) * 100);
            activePulls[name] = pct;
            const bar = document.getElementById(`pull-bar-${safeId}`);
            const txt = document.getElementById(`pull-text-${safeId}`);
            if (bar) bar.style.width = pct + '%';
            if (txt) txt.textContent = pct + '%';
          } else if (data.status) {
            const txt = document.getElementById(`pull-text-${safeId}`);
            if (txt) txt.textContent = data.status.slice(0, 30);
          }
        } catch { /* skip */ }
      }
    }

    delete activePulls[name];
    toast(`Pulled ${name} successfully`, 'success');
    await loadOllamaModels();
    renderOllamaInstalled();
    renderOllamaLibrary();
  } catch (err) {
    delete activePulls[name];
    toast(`Error pulling ${name}: ${err.message}`, 'error');
    actionEl.innerHTML = `<button class="btn btn-sm btn-primary" onclick="pullOllamaModel('${name}')">Pull</button>`;
  }
};

// ── Boot ──
init();
