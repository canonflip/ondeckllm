import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  loadConfig, saveConfig, setProvider, removeProvider,
  getTaskRoutes, setTaskRoutes, getActiveProfile, setActiveProfile, getProfiles,
  readOpenClawConfig, writeOpenClawConfig
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3900', 10);

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Provider Meta ──

const PROVIDER_META = {
  openai: {
    name: 'OpenAI', color: '#10a37f',
    testUrl: 'https://api.openai.com/v1/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini', 'dall-e-3', 'dall-e-2', 'whisper-1', 'tts-1']
  },
  anthropic: {
    name: 'Anthropic', color: '#d4a574',
    testUrl: 'https://api.anthropic.com/v1/messages',
    authHeader: key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    testMethod: 'POST',
    testBody: { model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] },
    models: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']
  },
  google: {
    name: 'Google AI', color: '#4285f4',
    testUrl: key => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    authHeader: () => ({}),
    models: ['gemini-2.0-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'imagen-3']
  },
  ollama: {
    name: 'Ollama (Local)', color: '#ffffff',
    testUrl: 'http://localhost:11434/api/tags',
    authHeader: () => ({}),
    local: true,
    models: ['llama3.2', 'codellama', 'mistral', 'mixtral', 'deepseek-coder-v2', 'phi3']
  },
  kyber: {
    name: 'Kyber (Remote Ollama)', color: '#a78bfa',
    testUrl: 'http://192.168.55.80:11434/api/tags',
    authHeader: () => ({}),
    local: true,
    models: []
  },
  groq: {
    name: 'Groq', color: '#f55036',
    testUrl: 'https://api.groq.com/openai/v1/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it']
  },
  mistral: {
    name: 'Mistral', color: '#ff7000',
    testUrl: 'https://api.mistral.ai/v1/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest']
  },
  deepseek: {
    name: 'DeepSeek', color: '#5b6ee1',
    testUrl: 'https://api.deepseek.com/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
  },
  together: {
    name: 'Together', color: '#6e56cf',
    testUrl: 'https://api.together.xyz/v1/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'mistralai/Mixtral-8x22B-Instruct-v0.1']
  },
  openrouter: {
    name: 'OpenRouter', color: '#c084fc',
    testUrl: 'https://openrouter.ai/api/v1/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['openai/gpt-4o', 'anthropic/claude-opus-4-6', 'google/gemini-2.0-pro']
  }
};

// ── Auto-Discovery on startup ──

async function runAutoDiscovery() {
  const oc = readOpenClawConfig();
  const config = loadConfig();
  const discovered = [];

  // Check OpenClaw providers for API keys
  for (const [ocId, ocProvider] of Object.entries(oc.providers)) {
    if (!ocProvider.apiKey) continue;

    // Map openclaw provider IDs to our provider IDs
    let providerId = ocId;
    if (ocId === 'gemini') providerId = 'google';

    if (providerId === 'kyber') {
      // Kyber is a remote Ollama - populate its models from openclaw config
      const models = (ocProvider.models || []).map(m => m.id);
      if (models.length > 0) {
        PROVIDER_META.kyber.models = models;
      }
      if (!config.providers.kyber) {
        config.providers.kyber = {
          apiKey: ocProvider.apiKey || '',
          status: 'configured',
          configuredAt: new Date().toISOString(),
          autoDiscovered: true,
          baseUrl: ocProvider.baseUrl
        };
        discovered.push('Kyber (Remote Ollama)');
      }
      continue;
    }

    if (PROVIDER_META[providerId] && !config.providers[providerId]) {
      config.providers[providerId] = {
        apiKey: ocProvider.apiKey,
        status: 'configured',
        configuredAt: new Date().toISOString(),
        autoDiscovered: true
      };
      discovered.push(PROVIDER_META[providerId].name);
    }
  }

  // Check auth-profiles for Anthropic key
  if (oc.authProfiles) {
    for (const [, profile] of Object.entries(oc.authProfiles)) {
      if (profile.provider === 'anthropic' && profile.token && !config.providers.anthropic) {
        config.providers.anthropic = {
          apiKey: profile.token,
          status: 'configured',
          configuredAt: new Date().toISOString(),
          autoDiscovered: true
        };
        discovered.push('Anthropic');
      }
    }
  }

  // Probe local Ollama
  for (const endpoint of [
    { id: 'ollama', url: 'http://localhost:11434/api/tags', name: 'Ollama (Local)' },
    { id: 'kyber', url: 'http://192.168.55.80:11434/api/tags', name: 'Kyber (Remote Ollama)' }
  ]) {
    try {
      const resp = await fetch(endpoint.url, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.models || []).map(m => m.name);
        if (models.length > 0) {
          PROVIDER_META[endpoint.id].models = [...new Set([...PROVIDER_META[endpoint.id].models, ...models])];
        }
        if (!config.providers[endpoint.id]) {
          config.providers[endpoint.id] = {
            apiKey: '',
            status: 'active',
            configuredAt: new Date().toISOString(),
            autoDiscovered: true
          };
          discovered.push(endpoint.name);
        } else if (config.providers[endpoint.id].status !== 'active') {
          config.providers[endpoint.id].status = 'active';
        }
      }
    } catch { /* endpoint unreachable */ }
  }

  if (discovered.length > 0) {
    saveConfig(config);
  }

  return discovered;
}

let discoveredProviders = [];

// ── Provider API ──

app.get('/api/providers/meta', (req, res) => {
  const meta = {};
  for (const [id, info] of Object.entries(PROVIDER_META)) {
    meta[id] = { name: info.name, color: info.color, models: info.models, local: !!info.local };
  }
  res.json(meta);
});

app.get('/api/providers', (req, res) => {
  const config = loadConfig();
  const result = {};
  for (const [id, info] of Object.entries(PROVIDER_META)) {
    const saved = config.providers[id];
    result[id] = {
      id, name: info.name, color: info.color, models: info.models, local: !!info.local,
      configured: !!saved,
      status: saved?.status || 'unconfigured',
      apiKey: saved?.apiKey ? '••••' + saved.apiKey.slice(-4) : null,
      autoDiscovered: saved?.autoDiscovered || false
    };
  }
  res.json(result);
});

app.post('/api/providers/:id', (req, res) => {
  const { id } = req.params;
  const { apiKey } = req.body;
  if (!PROVIDER_META[id]) return res.status(404).json({ error: 'Unknown provider' });
  const data = { apiKey: apiKey || '', status: 'configured', configuredAt: new Date().toISOString() };
  setProvider(id, data);
  res.json({ ok: true, status: 'configured' });
});

app.delete('/api/providers/:id', (req, res) => {
  const { id } = req.params;
  removeProvider(id);
  res.json({ ok: true });
});

app.post('/api/providers/:id/test', async (req, res) => {
  const { id } = req.params;
  const meta = PROVIDER_META[id];
  if (!meta) return res.status(404).json({ error: 'Unknown provider' });

  const config = loadConfig();
  const saved = config.providers[id];
  const apiKey = saved?.apiKey || '';

  try {
    const url = typeof meta.testUrl === 'function' ? meta.testUrl(apiKey) : meta.testUrl;
    const headers = { 'Content-Type': 'application/json', ...meta.authHeader(apiKey) };
    const method = meta.testMethod || 'GET';
    const fetchOpts = { method, headers, signal: AbortSignal.timeout(10000) };
    if (method === 'POST' && meta.testBody) {
      fetchOpts.body = JSON.stringify(meta.testBody);
    }
    const resp = await fetch(url, fetchOpts);

    if (resp.ok || (id === 'anthropic' && resp.status < 500)) {
      // For Ollama endpoints, refresh model list
      if ((id === 'ollama' || id === 'kyber') && resp.ok) {
        try {
          const data = await resp.clone().json();
          const models = (data.models || []).map(m => m.name);
          if (models.length > 0) {
            PROVIDER_META[id].models = [...new Set([...PROVIDER_META[id].models, ...models])];
          }
        } catch { /* ignore */ }
      }
      const data = { ...saved, status: 'active', lastTestedAt: new Date().toISOString() };
      setProvider(id, data);
      res.json({ ok: true, status: 'active', message: 'Connection successful' });
    } else {
      const text = await resp.text().catch(() => '');
      const data = { ...saved, status: 'error', lastTestedAt: new Date().toISOString() };
      setProvider(id, data);
      res.json({ ok: false, status: 'error', message: `HTTP ${resp.status}: ${text.slice(0, 200)}` });
    }
  } catch (err) {
    const data = { ...saved, status: 'error', lastTestedAt: new Date().toISOString() };
    setProvider(id, data);
    res.json({ ok: false, status: 'error', message: err.message });
  }
});

// ── Discovery API ──

app.get('/api/discovery', (req, res) => {
  res.json({ discovered: discoveredProviders });
});

// ── Task Routes API ──

app.get('/api/routes', (req, res) => {
  res.json(getTaskRoutes());
});

app.put('/api/routes', (req, res) => {
  setTaskRoutes(req.body);
  // Sync back to OpenClaw config
  const syncResult = writeOpenClawConfig(req.body);
  res.json({ ok: true, synced: syncResult.ok });
});

// ── Profiles API ──

app.get('/api/profiles', (req, res) => {
  res.json({ profiles: getProfiles(), active: getActiveProfile() });
});

app.post('/api/profiles/activate', (req, res) => {
  const { profileId } = req.body;
  setActiveProfile(profileId);
  const routes = getTaskRoutes();
  // Sync to OpenClaw on profile activation too
  writeOpenClawConfig(routes);
  res.json({ ok: true, active: profileId, routes });
});

// ── Serve frontend ──

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── Start ──

async function start() {
  console.log(`\n  Starting auto-discovery...`);
  discoveredProviders = await runAutoDiscovery();
  if (discoveredProviders.length > 0) {
    console.log(`  Found ${discoveredProviders.length} provider(s): ${discoveredProviders.join(', ')}`);
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`);
    console.log(`  \u2502    OnDeckLLM v1.1                     \u2502`);
    console.log(`  \u2502    http://localhost:${PORT}              \u2502`);
    console.log(`  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n`);
  });
}

start();
