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
  renderRouter();
  renderProfiles();
  renderSupport();
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

function createProviderCard(id, info) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = `provider-${id}`;

  const statusClass = info.status || 'unconfigured';
  const statusLabel = {
    active: 'Active', configured: 'Configured', error: 'Error', unconfigured: 'Not Set Up'
  }[statusClass] || statusClass;

  const discoveredBadge = info.autoDiscovered ? '<span class="auto-discovered-badge">AUTO</span>' : '';

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">
        <div class="provider-dot" style="background:${info.color};box-shadow:0 0 6px ${info.color}44"></div>
        <h3>${info.name}</h3>
        ${info.local ? '<span class="model-tag">LOCAL</span>' : ''}
        ${discoveredBadge}
      </div>
      <span class="status-badge ${statusClass}">${statusClass === 'active' ? '\u2714 ' : ''}${statusLabel}</span>
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
        ${renderProviderSignupCard('Together', '#6e56cf', 'https://together.ai', 'Open-source model hosting')}
        ${renderProviderSignupCard('Ollama', '#ffffff', 'https://ollama.com', 'Run models locally — free')}
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

// ── Boot ──
init();
