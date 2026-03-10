import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  loadConfig, saveConfig, setProvider, removeProvider,
  getTaskRoutes, setTaskRoutes, getActiveProfile, setActiveProfile, getProfiles,
  readOpenClawConfig, writeOpenClawConfig
} from './storage.js';
import {
  logUsage, getRawEntries, getUsageSummary, calculateCost, getPricing,
  importOpenClawSessions
} from './cost-tracker.js';

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
  "remote-ollama": {
    name: 'Remote Ollama', color: '#a78bfa',
    testUrl: 'http://localhost:11434/api/tags',
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
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-nemo', 'mistral-embed']
  },
  deepseek: {
    name: 'DeepSeek', color: '#5b6ee1',
    testUrl: 'https://api.deepseek.com/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
  },
  together: {
    name: 'Together AI', color: '#6e56cf',
    testUrl: 'https://api.together.xyz/v1/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x22B-Instruct-v0.1', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1']
  },
  openrouter: {
    name: 'OpenRouter', color: '#c084fc',
    testUrl: 'https://openrouter.ai/api/v1/models',
    authHeader: key => ({ Authorization: `Bearer ${key}` }),
    models: ['openai/gpt-4o', 'anthropic/claude-opus-4-6', 'google/gemini-2.0-pro', 'meta-llama/llama-3.1-405b-instruct', 'mistralai/mistral-large']
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

    if (providerId === 'remote-ollama') {
      // Remote Ollama - populate models from openclaw config - populate its models from openclaw config
      const models = (ocProvider.models || []).map(m => m.id);
      if (models.length > 0) {
        PROVIDER_META["remote-ollama"].models = models;
      }
      if (!config.providers["remote-ollama"]) {
        config.providers["remote-ollama"] = {
          apiKey: ocProvider.apiKey || '',
          status: 'configured',
          configuredAt: new Date().toISOString(),
          autoDiscovered: true,
          baseUrl: ocProvider.baseUrl
        };
        discovered.push('Remote Ollama');
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
    { id: 'remote-ollama', url: 'http://localhost:11434/api/tags', name: 'Remote Ollama' }
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
      autoDiscovered: saved?.autoDiscovered || false,
      lastTestOk: saved?.lastTestOk ?? null,
      lastLatency: saved?.lastLatency ?? null,
      lastTestedAt: saved?.lastTestedAt ?? null,
      baseUrl: saved?.baseUrl ?? null
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

  // For remote-ollama, use the stored baseUrl for the test
  let testUrl = typeof meta.testUrl === 'function' ? meta.testUrl(apiKey) : meta.testUrl;
  if (id === 'remote-ollama' && saved?.baseUrl) {
    testUrl = saved.baseUrl.replace(/\/+$/, '') + '/api/tags';
  }

  const startTime = Date.now();
  try {
    const headers = { 'Content-Type': 'application/json', ...meta.authHeader(apiKey) };
    const method = meta.testMethod || 'GET';
    const fetchOpts = { method, headers, signal: AbortSignal.timeout(10000) };
    if (method === 'POST' && meta.testBody) {
      fetchOpts.body = JSON.stringify(meta.testBody);
    }
    const resp = await fetch(testUrl, fetchOpts);
    const latency = Date.now() - startTime;

    if (resp.ok || (id === 'anthropic' && resp.status < 500)) {
      // For Ollama endpoints, refresh model list
      if ((id === 'ollama' || id === 'remote-ollama') && resp.ok) {
        try {
          const data = await resp.clone().json();
          const models = (data.models || []).map(m => m.name);
          if (models.length > 0) {
            PROVIDER_META[id].models = [...new Set([...PROVIDER_META[id].models, ...models])];
          }
        } catch { /* ignore */ }
      }
      const data = { ...saved, status: 'active', lastTestedAt: new Date().toISOString(), lastTestOk: true, lastLatency: latency };
      setProvider(id, data);
      res.json({ ok: true, status: 'active', message: 'Connection successful', latency });
    } else {
      const text = await resp.text().catch(() => '');
      const latencyFail = Date.now() - startTime;
      const data = { ...saved, status: 'error', lastTestedAt: new Date().toISOString(), lastTestOk: false, lastLatency: latencyFail };
      setProvider(id, data);
      res.json({ ok: false, status: 'error', message: `HTTP ${resp.status}: ${text.slice(0, 200)}`, latency: latencyFail });
    }
  } catch (err) {
    const latency = Date.now() - startTime;
    const data = { ...saved, status: 'error', lastTestedAt: new Date().toISOString(), lastTestOk: false, lastLatency: latency };
    setProvider(id, data);
    res.json({ ok: false, status: 'error', message: err.message, latency });
  }
});

// ── Auto-test all configured providers (background health check) ──

app.post('/api/providers/test-all', async (req, res) => {
  const config = loadConfig();
  const results = {};

  const tests = Object.entries(config.providers).map(async ([id, saved]) => {
    const meta = PROVIDER_META[id];
    if (!meta) return;
    const apiKey = saved?.apiKey || '';

    let testUrl = typeof meta.testUrl === 'function' ? meta.testUrl(apiKey) : meta.testUrl;
    if (id === 'remote-ollama' && saved?.baseUrl) {
      testUrl = saved.baseUrl.replace(/\/+$/, '') + '/api/tags';
    }

    const startTime = Date.now();
    try {
      const headers = { 'Content-Type': 'application/json', ...meta.authHeader(apiKey) };
      const method = meta.testMethod || 'GET';
      const fetchOpts = { method, headers, signal: AbortSignal.timeout(10000) };
      if (method === 'POST' && meta.testBody) {
        fetchOpts.body = JSON.stringify(meta.testBody);
      }
      const resp = await fetch(testUrl, fetchOpts);
      const latency = Date.now() - startTime;
      const ok = resp.ok || (id === 'anthropic' && resp.status < 500);

      if (ok && (id === 'ollama' || id === 'remote-ollama') && resp.ok) {
        try {
          const data = await resp.clone().json();
          const models = (data.models || []).map(m => m.name);
          if (models.length > 0) {
            PROVIDER_META[id].models = [...new Set([...PROVIDER_META[id].models, ...models])];
          }
        } catch { /* ignore */ }
      }

      results[id] = { ok, latency, lastTestOk: ok, lastLatency: latency };
      setProvider(id, { ...saved, status: ok ? 'active' : 'error', lastTestedAt: new Date().toISOString(), lastTestOk: ok, lastLatency: latency });
    } catch {
      const latency = Date.now() - startTime;
      results[id] = { ok: false, latency, lastTestOk: false, lastLatency: latency };
      setProvider(id, { ...saved, status: 'error', lastTestedAt: new Date().toISOString(), lastTestOk: false, lastLatency: latency });
    }
  });

  await Promise.allSettled(tests);
  res.json({ results });
});

// ── Ollama Model Browser API ──

const OLLAMA_LIBRARY = [
  { name: 'llama3.2', description: 'Meta Llama 3.2 — latest small & medium models', size: '2B-90B' },
  { name: 'llama3.1', description: 'Meta Llama 3.1 — flagship open model', size: '8B-405B' },
  { name: 'codellama', description: 'Code-specialized Llama model', size: '7B-70B' },
  { name: 'mistral', description: 'Mistral 7B — fast and capable', size: '7B' },
  { name: 'mixtral', description: 'Mixtral MoE — high quality mixture of experts', size: '8x7B-8x22B' },
  { name: 'phi3', description: 'Microsoft Phi-3 — small but powerful', size: '3.8B-14B' },
  { name: 'gemma2', description: 'Google Gemma 2 — efficient open model', size: '2B-27B' },
  { name: 'qwen2.5', description: 'Alibaba Qwen 2.5 — multilingual powerhouse', size: '0.5B-72B' },
  { name: 'deepseek-coder-v2', description: 'DeepSeek Coder V2 — coding specialist', size: '16B-236B' },
  { name: 'deepseek-r1', description: 'DeepSeek R1 — reasoning model', size: '1.5B-671B' },
  { name: 'command-r', description: 'Cohere Command R — RAG optimized', size: '35B' },
  { name: 'starcoder2', description: 'BigCode StarCoder2 — code generation', size: '3B-15B' },
  { name: 'nomic-embed-text', description: 'Nomic Embed — text embeddings', size: '137M' },
  { name: 'llava', description: 'LLaVA — multimodal vision+language', size: '7B-34B' },
  { name: 'dolphin-mixtral', description: 'Dolphin Mixtral — uncensored MoE', size: '8x7B' },
  { name: 'neural-chat', description: 'Intel Neural Chat — fine-tuned for chat', size: '7B' },
  { name: 'solar', description: 'Upstage Solar — merged architecture', size: '10.7B' },
  { name: 'vicuna', description: 'Vicuna — fine-tuned LLaMA for chat', size: '7B-33B' },
  { name: 'nous-hermes2', description: 'Nous Hermes 2 — general purpose', size: '7B-34B' },
  { name: 'yi', description: 'Yi — bilingual open model by 01.AI', size: '6B-34B' }
];

function getOllamaBaseUrl(providerId) {
  if (providerId === 'ollama') return 'http://localhost:11434';
  const config = loadConfig();
  const saved = config.providers['remote-ollama'];
  return (saved?.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
}

app.get('/api/ollama/models', async (req, res) => {
  const source = req.query.source || 'ollama';
  const baseUrl = getOllamaBaseUrl(source);
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return res.json({ models: [], error: `HTTP ${resp.status}` });
    const data = await resp.json();
    const models = (data.models || []).map(m => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
      digest: m.digest,
      details: m.details || {}
    }));
    res.json({ models, source, baseUrl });
  } catch (err) {
    res.json({ models: [], error: err.message, source, baseUrl });
  }
});

app.get('/api/ollama/library', (req, res) => {
  res.json({ models: OLLAMA_LIBRARY });
});

app.post('/api/ollama/pull', async (req, res) => {
  const { model, source } = req.body;
  if (!model) return res.status(400).json({ error: 'Model name required' });
  const baseUrl = getOllamaBaseUrl(source || 'ollama');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const resp = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true })
    });

    if (!resp.ok) {
      res.write(`data: ${JSON.stringify({ error: `HTTP ${resp.status}` })}\n\n`);
      res.end();
      return;
    }

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
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch { /* skip non-JSON lines */ }
        }
      }
    }
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        res.write(`data: ${JSON.stringify(parsed)}\n\n`);
      } catch { /* skip */ }
    }
    res.write(`data: ${JSON.stringify({ status: 'success' })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.delete('/api/ollama/delete', async (req, res) => {
  const { model, source } = req.body;
  if (!model) return res.status(400).json({ error: 'Model name required' });
  const baseUrl = getOllamaBaseUrl(source || 'ollama');

  try {
    const resp = await fetch(`${baseUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model })
    });
    if (resp.ok) {
      res.json({ ok: true, message: `Deleted ${model}` });
    } else {
      const text = await resp.text().catch(() => '');
      res.json({ ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
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

// ── Usage / Cost Tracker API ──

app.post('/api/usage/log', (req, res) => {
  try {
    const entry = logUsage(req.body);
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/usage/summary', (req, res) => {
  const range = req.query.range || 'all';
  res.json(getUsageSummary(range));
});

app.get('/api/usage/raw', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  res.json({ entries: getRawEntries(limit) });
});

app.get('/api/usage/pricing', (req, res) => {
  res.json(getPricing());
});

// ── A/B Compare API ──

function buildProviderRequest(providerId, model, prompt, maxTokens) {
  const config = loadConfig();
  const saved = config.providers[providerId];
  const apiKey = saved?.apiKey || '';

  if (providerId === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }]
        })
      },
      parseResponse: (data) => ({
        text: data.content?.[0]?.text || '',
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0
      })
    };
  }

  if (providerId === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens }
        })
      },
      parseResponse: (data) => ({
        text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0
      })
    };
  }

  if (providerId === 'ollama' || providerId === 'remote-ollama') {
    const baseUrl = getOllamaBaseUrl(providerId);
    return {
      url: `${baseUrl}/api/chat`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          options: { num_predict: maxTokens }
        })
      },
      parseResponse: (data) => ({
        text: data.message?.content || '',
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0
      })
    };
  }

  // OpenAI-compatible format (openai, groq, mistral, deepseek, together, openrouter)
  const endpoints = {
    openai: 'https://api.openai.com/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    mistral: 'https://api.mistral.ai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    together: 'https://api.together.xyz/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions'
  };

  return {
    url: endpoints[providerId] || endpoints.openai,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    },
    parseResponse: (data) => ({
      text: data.choices?.[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0
    })
  };
}

async function runModelRequest(providerId, model, prompt, maxTokens) {
  const { url, options, parseResponse } = buildProviderRequest(providerId, model, prompt, maxTokens);
  const startTime = Date.now();
  const resp = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  const latencyMs = Date.now() - startTime;

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const parsed = parseResponse(data);
  const cost = calculateCost(model, parsed.inputTokens, parsed.outputTokens);

  // Log to usage tracker
  logUsage({ provider: providerId, model, inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, cost, latencyMs });

  return {
    response: parsed.text,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    latencyMs,
    cost
  };
}

app.post('/api/compare', async (req, res) => {
  const { prompt, modelA, modelB, maxTokens = 1024 } = req.body;
  if (!prompt || !modelA || !modelB) {
    return res.status(400).json({ error: 'prompt, modelA, and modelB are required' });
  }

  // Parse "provider/model" format
  const [provA, ...modA] = modelA.split('/');
  const [provB, ...modB] = modelB.split('/');
  const modelNameA = modA.join('/');
  const modelNameB = modB.join('/');

  try {
    const [resultA, resultB] = await Promise.allSettled([
      runModelRequest(provA, modelNameA, prompt, maxTokens),
      runModelRequest(provB, modelNameB, prompt, maxTokens)
    ]);

    res.json({
      a: resultA.status === 'fulfilled' ? resultA.value : { error: resultA.reason?.message || 'Failed' },
      b: resultB.status === 'fulfilled' ? resultB.value : { error: resultB.reason?.message || 'Failed' }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Ollama Setup Wizard API ──

const OLLAMA_PACKS = [
  {
    id: 'essentials',
    name: 'Essentials',
    description: 'Chat + coding + embeddings — covers the basics',
    icon: '\u2B50',
    models: ['llama3.2', 'codellama', 'nomic-embed-text'],
    totalSize: '~6 GB'
  },
  {
    id: 'privacy',
    name: 'Privacy Pack',
    description: 'All local, vision capable — zero cloud dependency',
    icon: '\uD83D\uDD12',
    models: ['deepseek-r1', 'codellama', 'llava'],
    totalSize: '~12 GB'
  },
  {
    id: 'developer',
    name: 'Developer',
    description: 'Coding-focused models for software development',
    icon: '\uD83D\uDCBB',
    models: ['codellama', 'deepseek-coder-v2', 'qwen2.5'],
    totalSize: '~15 GB'
  },
  {
    id: 'lightweight',
    name: 'Lightweight',
    description: 'Small models for limited RAM systems',
    icon: '\uD83E\uDEB6',
    models: ['phi3', 'gemma2:2b'],
    totalSize: '~4 GB'
  }
];

app.get('/api/ollama/status', async (req, res) => {
  const result = { installed: false, running: false, version: '', modelsInstalled: [] };

  // Check if Ollama is running by probing the API
  try {
    const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      result.running = true;
      result.installed = true;
      const data = await resp.json();
      result.modelsInstalled = (data.models || []).map(m => m.name);
    }
  } catch { /* not running */ }

  // Try to get version
  if (result.running) {
    try {
      const vResp = await fetch('http://localhost:11434/api/version', { signal: AbortSignal.timeout(3000) });
      if (vResp.ok) {
        const vData = await vResp.json();
        result.version = vData.version || '';
      }
    } catch { /* ignore */ }
  }

  // If not running, check if installed via common paths
  if (!result.installed) {
    try {
      const { execSync } = await import('child_process');
      execSync('which ollama', { timeout: 3000 });
      result.installed = true;
    } catch { /* not installed */ }
  }

  res.json(result);
});

app.get('/api/ollama/packs', (req, res) => {
  res.json({ packs: OLLAMA_PACKS });
});

app.post('/api/ollama/install-pack', async (req, res) => {
  const { packId, source } = req.body;
  const pack = OLLAMA_PACKS.find(p => p.id === packId);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });

  const baseUrl = getOllamaBaseUrl(source || 'ollama');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for (let i = 0; i < pack.models.length; i++) {
    const model = pack.models[i];
    res.write(`data: ${JSON.stringify({ type: 'start', model, index: i, total: pack.models.length })}\n\n`);

    try {
      const pullResp = await fetch(`${baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: true })
      });

      if (!pullResp.ok) {
        res.write(`data: ${JSON.stringify({ type: 'error', model, error: `HTTP ${pullResp.status}` })}\n\n`);
        continue;
      }

      const reader = pullResp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              res.write(`data: ${JSON.stringify({ type: 'progress', model, ...parsed })}\n\n`);
            } catch { /* skip */ }
          }
        }
      }
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          res.write(`data: ${JSON.stringify({ type: 'progress', model, ...parsed })}\n\n`);
        } catch { /* skip */ }
      }

      res.write(`data: ${JSON.stringify({ type: 'done', model })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', model, error: err.message })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ type: 'complete', packId })}\n\n`);
  res.end();
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

  // Import OpenClaw session data for cost tracker
  try {
    const importResult = await importOpenClawSessions();
    if (importResult.imported > 0) {
      console.log(`  Imported ${importResult.imported} usage entries from OpenClaw sessions`);
    }
  } catch { /* silent */ }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`);
    console.log(`  \u2502    OnDeckLLM v1.3                     \u2502`);
    console.log(`  \u2502    http://localhost:${PORT}              \u2502`);
    console.log(`  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n`);
  });
}

start();
