import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const DATA_DIR = join(homedir(), '.ondeckllm');
const USAGE_FILE = join(DATA_DIR, 'usage.jsonl');
const OPENCLAW_SESSIONS_DIR = join(homedir(), '.openclaw', 'sessions');
const IMPORT_MARKER = join(DATA_DIR, '.openclaw-imported');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── Pricing (per 1M tokens) ──

const PRICING = {
  // OpenAI
  'gpt-4o':           { input: 2.50, output: 10.00 },
  'gpt-4o-mini':      { input: 0.15, output: 0.60 },
  'o3':               { input: 10.00, output: 40.00 },
  'o4-mini':          { input: 1.10, output: 4.40 },
  // Anthropic
  'claude-opus-4-6':               { input: 15.00, output: 75.00 },
  'claude-sonnet-4-5-20250929':    { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001':     { input: 0.80, output: 4.00 },
  // Google
  'gemini-2.0-pro':   { input: 1.25, output: 5.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  // Groq
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant':    { input: 0.05, output: 0.08 },
  'mixtral-8x7b-32768':      { input: 0.24, output: 0.24 },
  'gemma2-9b-it':            { input: 0.20, output: 0.20 },
  // Mistral
  'mistral-large-latest':  { input: 2.00, output: 6.00 },
  'mistral-medium-latest': { input: 2.50, output: 7.50 },
  'mistral-small-latest':  { input: 0.20, output: 0.60 },
  'codestral-latest':      { input: 0.30, output: 0.90 },
  // DeepSeek
  'deepseek-chat':     { input: 0.27, output: 1.10 },
  'deepseek-coder':    { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Together
  'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo': { input: 3.50, output: 3.50 },
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo':  { input: 0.88, output: 0.88 },
  // OpenRouter (varies, use rough estimates)
  'openai/gpt-4o':                 { input: 2.50, output: 10.00 },
  'anthropic/claude-opus-4-6':     { input: 15.00, output: 75.00 },
  'google/gemini-2.0-pro':         { input: 1.25, output: 5.00 },
  // Ollama (free/local)
  // Default fallback for unknown models
};

export function calculateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model];
  if (!pricing) return 0; // local/unknown = free
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function getPricing() {
  return PRICING;
}

// ── Log a usage entry ──

export function logUsage(entry) {
  ensureDataDir();
  const record = {
    ts: entry.ts || Date.now(),
    provider: entry.provider,
    model: entry.model,
    inputTokens: entry.inputTokens || 0,
    outputTokens: entry.outputTokens || 0,
    cost: entry.cost ?? calculateCost(entry.model, entry.inputTokens || 0, entry.outputTokens || 0),
    latencyMs: entry.latencyMs || 0
  };
  appendFileSync(USAGE_FILE, JSON.stringify(record) + '\n');
  return record;
}

// ── Read all entries ──

function readAllEntries() {
  ensureDataDir();
  if (!existsSync(USAGE_FILE)) return [];
  try {
    const raw = readFileSync(USAGE_FILE, 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// ── Raw entries (most recent N) ──

export function getRawEntries(limit = 100) {
  const entries = readAllEntries();
  return entries.slice(-limit).reverse();
}

// ── Summary with aggregation ──

export function getUsageSummary(range = 'all') {
  const entries = readAllEntries();
  const now = Date.now();

  // Time ranges
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  const startOfWeek = new Date(); startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); startOfWeek.setHours(0,0,0,0);
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);

  const rangeStart = {
    today: startOfDay.getTime(),
    week: startOfWeek.getTime(),
    month: startOfMonth.getTime(),
    all: 0
  }[range] || 0;

  const filtered = entries.filter(e => e.ts >= rangeStart);

  // Totals
  let totalCost = 0, totalInputTokens = 0, totalOutputTokens = 0, totalRequests = 0;
  const byProvider = {};
  const byModel = {};

  for (const e of filtered) {
    totalCost += e.cost || 0;
    totalInputTokens += e.inputTokens || 0;
    totalOutputTokens += e.outputTokens || 0;
    totalRequests++;

    // By provider
    if (!byProvider[e.provider]) {
      byProvider[e.provider] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0, totalLatency: 0 };
    }
    byProvider[e.provider].cost += e.cost || 0;
    byProvider[e.provider].inputTokens += e.inputTokens || 0;
    byProvider[e.provider].outputTokens += e.outputTokens || 0;
    byProvider[e.provider].requests++;
    byProvider[e.provider].totalLatency += e.latencyMs || 0;

    // By model
    if (!byModel[e.model]) {
      byModel[e.model] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    byModel[e.model].cost += e.cost || 0;
    byModel[e.model].inputTokens += e.inputTokens || 0;
    byModel[e.model].outputTokens += e.outputTokens || 0;
    byModel[e.model].requests++;
  }

  // Compute avg latency per provider
  for (const [, v] of Object.entries(byProvider)) {
    v.avgLatency = v.requests > 0 ? Math.round(v.totalLatency / v.requests) : 0;
    delete v.totalLatency;
  }

  // Daily timeseries (last 30 days)
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const dailyMap = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { date: key, cost: 0, requests: 0 };
  }
  for (const e of entries) {
    if (e.ts < thirtyDaysAgo) continue;
    const key = new Date(e.ts).toISOString().slice(0, 10);
    if (dailyMap[key]) {
      dailyMap[key].cost += e.cost || 0;
      dailyMap[key].requests++;
    }
  }
  const daily = Object.values(dailyMap);

  // Per-range totals for summary cards
  const todayEntries = entries.filter(e => e.ts >= startOfDay.getTime());
  const weekEntries = entries.filter(e => e.ts >= startOfWeek.getTime());
  const monthEntries = entries.filter(e => e.ts >= startOfMonth.getTime());

  const todayCost = todayEntries.reduce((s, e) => s + (e.cost || 0), 0);
  const weekCost = weekEntries.reduce((s, e) => s + (e.cost || 0), 0);
  const monthCost = monthEntries.reduce((s, e) => s + (e.cost || 0), 0);
  const allCost = entries.reduce((s, e) => s + (e.cost || 0), 0);

  return {
    range,
    totalCost, totalInputTokens, totalOutputTokens, totalRequests,
    todayCost, weekCost, monthCost, allCost,
    byProvider, byModel, daily
  };
}

// ── OpenClaw Session Import ──

export async function importOpenClawSessions() {
  ensureDataDir();

  // Don't re-import if already done
  if (existsSync(IMPORT_MARKER)) return { imported: 0, skipped: true };

  if (!existsSync(OPENCLAW_SESSIONS_DIR)) return { imported: 0, error: 'No sessions directory' };

  let imported = 0;

  try {
    const files = readdirSync(OPENCLAW_SESSIONS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));

    for (const file of jsonFiles) {
      try {
        const filePath = join(OPENCLAW_SESSIONS_DIR, file);
        const raw = readFileSync(filePath, 'utf-8');

        // Try JSONL first (one JSON per line)
        const lines = raw.trim().split('\n');
        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            // OpenClaw session format — look for usage/token data
            if (data.usage || data.tokenUsage || data.tokens) {
              const usage = data.usage || data.tokenUsage || data.tokens || {};
              const inputTokens = usage.input_tokens || usage.inputTokens || usage.prompt_tokens || 0;
              const outputTokens = usage.output_tokens || usage.outputTokens || usage.completion_tokens || 0;

              if (inputTokens > 0 || outputTokens > 0) {
                const model = data.model || data.modelId || 'unknown';
                const provider = data.provider || guessProvider(model);
                const ts = data.timestamp ? new Date(data.timestamp).getTime() :
                           data.createdAt ? new Date(data.createdAt).getTime() :
                           data.ts || Date.now();

                logUsage({
                  ts,
                  provider,
                  model,
                  inputTokens,
                  outputTokens,
                  cost: calculateCost(model, inputTokens, outputTokens),
                  latencyMs: data.latencyMs || data.latency || 0
                });
                imported++;
              }
            }

            // Also check for nested message arrays with usage
            if (Array.isArray(data.messages)) {
              for (const msg of data.messages) {
                if (msg.usage) {
                  const inputTokens = msg.usage.input_tokens || msg.usage.prompt_tokens || 0;
                  const outputTokens = msg.usage.output_tokens || msg.usage.completion_tokens || 0;
                  if (inputTokens > 0 || outputTokens > 0) {
                    const model = msg.model || data.model || 'unknown';
                    const provider = msg.provider || data.provider || guessProvider(model);
                    logUsage({
                      ts: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                      provider,
                      model,
                      inputTokens,
                      outputTokens,
                      cost: calculateCost(model, inputTokens, outputTokens),
                      latencyMs: msg.latencyMs || 0
                    });
                    imported++;
                  }
                }
              }
            }
          } catch { /* skip unparseable lines */ }
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* sessions dir read error */ }

  // Mark as imported
  writeFileSync(IMPORT_MARKER, new Date().toISOString());

  return { imported, skipped: false };
}

function guessProvider(model) {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.includes('gpt') || m.includes('o3') || m.includes('o4') || m.includes('dall-e')) return 'openai';
  if (m.includes('gemini') || m.includes('imagen')) return 'google';
  if (m.includes('llama') || m.includes('mixtral') || m.includes('gemma')) return 'groq';
  if (m.includes('mistral') || m.includes('codestral')) return 'mistral';
  if (m.includes('deepseek')) return 'deepseek';
  return 'unknown';
}
