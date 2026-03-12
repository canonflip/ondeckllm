import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.ondeckllm');
const CONFIG_FILE = join(DATA_DIR, 'config.json');
const OPENCLAW_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG = join(OPENCLAW_DIR, 'openclaw.json');
const OPENCLAW_AUTH = join(OPENCLAW_DIR, 'auth-profiles.json');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getDefaultConfig() {
  return {
    providers: {},
    globalLineup: [],
    activeProfile: null,
    profiles: {
      budget: {
        name: 'Budget',
        description: 'Cheapest models first, local fallbacks',
        icon: '\u{1F4B0}',
        routes: [
          { provider: 'groq', model: 'llama-3.3-70b-versatile' },
          { provider: 'deepseek', model: 'deepseek-chat' },
          { provider: 'ollama', model: 'llama3.2' }
        ]
      },
      quality: {
        name: 'Quality First',
        description: 'Best models regardless of cost',
        icon: '\u{1F451}',
        routes: [
          { provider: 'anthropic', model: 'claude-opus-4-6' },
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'google', model: 'gemini-2.0-pro' }
        ]
      },
      local: {
        name: 'Local Only',
        description: 'Ollama models only, zero cloud calls',
        icon: '\u{1F3E0}',
        routes: [
          { provider: 'ollama', model: 'llama3.2' },
          { provider: 'ollama', model: 'codellama' },
          { provider: 'ollama', model: 'mistral' }
        ]
      },
      privacy: {
        name: 'Privacy Mode',
        description: 'Local models + CloakClaw proxy for cloud calls',
        icon: '\u{1F512}',
        routes: [
          { provider: 'ollama', model: 'llama3.2' },
          { provider: 'ollama', model: 'codellama' },
          { provider: 'ollama', model: 'mistral' }
        ]
      },
      speed: {
        name: 'Speed Demon',
        description: 'Fastest response times first',
        icon: '\u26A1',
        routes: [
          { provider: 'groq', model: 'llama-3.3-70b-versatile' },
          { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
          { provider: 'openai', model: 'gpt-4o-mini' }
        ]
      }
    }
  };
}

export function loadConfig() {
  ensureDataDir();
  if (!existsSync(CONFIG_FILE)) {
    const defaults = getDefaultConfig();
    writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    const defaults = getDefaultConfig();
    const merged = { ...defaults, ...config, profiles: { ...defaults.profiles, ...config.profiles } };
    // Migrate old per-task taskRoutes to globalLineup
    if (config.taskRoutes && !config.globalLineup) {
      const coding = config.taskRoutes.coding || [];
      if (coding.length > 0) {
        merged.globalLineup = coding;
      }
      delete merged.taskRoutes;
    }
    // Migrate old profile taskRoutes to routes
    for (const [id, profile] of Object.entries(merged.profiles)) {
      if (profile.taskRoutes && !profile.routes) {
        merged.profiles[id].routes = profile.taskRoutes.coding || [];
        delete merged.profiles[id].taskRoutes;
      }
    }
    return merged;
  } catch {
    const defaults = getDefaultConfig();
    writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

export function saveConfig(config) {
  ensureDataDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getProvider(id) {
  const config = loadConfig();
  return config.providers[id] || null;
}

export function setProvider(id, data) {
  const config = loadConfig();
  config.providers[id] = data;
  saveConfig(config);
  return config.providers[id];
}

export function removeProvider(id) {
  const config = loadConfig();
  delete config.providers[id];
  saveConfig(config);
}

export function getGlobalLineup() {
  const config = loadConfig();
  return config.globalLineup || [];
}

export function setGlobalLineup(lineup) {
  const config = loadConfig();
  config.globalLineup = lineup;
  saveConfig(config);
}

export function getActiveProfile() {
  const config = loadConfig();
  return config.activeProfile;
}

export function setActiveProfile(profileId) {
  const config = loadConfig();
  config.activeProfile = profileId;
  if (profileId && config.profiles[profileId]) {
    config.globalLineup = JSON.parse(JSON.stringify(config.profiles[profileId].routes || []));
  }
  saveConfig(config);
}

export function getProfiles() {
  const config = loadConfig();
  return config.profiles;
}

export function getProviderOrder() {
  const config = loadConfig();
  return config.providerOrder || null;
}

export function setProviderOrder(order) {
  const config = loadConfig();
  config.providerOrder = order;
  saveConfig(config);
}

// ── OpenClaw Config Integration ──

export function readOpenClawConfig() {
  const result = { providers: {}, models: {}, agents: {} };
  try {
    if (existsSync(OPENCLAW_CONFIG)) {
      const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
      const oc = parseJsonPermissive(raw);
      result.providers = oc.models?.providers || {};
      result.agents = oc.agents?.defaults || {};
      result.auth = oc.auth || {};

      // Read batting order from agents.defaults.model -> globalLineup
      const modelConfig = oc.agents?.defaults?.model;
      if (modelConfig?.primary) {
        const lineup = [];
        const [prov, ...modelParts] = modelConfig.primary.split(':');
        if (prov && modelParts.length > 0) {
          lineup.push({ provider: prov, model: modelParts.join(':') });
        }
        for (const fb of (modelConfig.fallbacks || [])) {
          const [fbProv, ...fbModelParts] = fb.split(':');
          if (fbProv && fbModelParts.length > 0) {
            lineup.push({ provider: fbProv, model: fbModelParts.join(':') });
          }
        }
        result.lineup = lineup;
      }
    }
  } catch { /* ignore parse errors */ }

  try {
    if (existsSync(OPENCLAW_AUTH)) {
      const raw = readFileSync(OPENCLAW_AUTH, 'utf-8');
      result.authProfiles = JSON.parse(raw);
    }
  } catch { /* ignore */ }

  return result;
}

// Seed global lineup from OpenClaw config if our lineup is empty
export function seedLineupFromOpenClaw() {
  const oc = readOpenClawConfig();
  if (!oc.lineup || oc.lineup.length === 0) return false;
  const config = loadConfig();
  if (config.globalLineup && config.globalLineup.length > 0) return false;
  config.globalLineup = oc.lineup;
  saveConfig(config);
  return true;
}

export function writeOpenClawConfig(lineup) {
  if (!existsSync(OPENCLAW_CONFIG)) return { ok: false, error: 'openclaw.json not found' };
  if (!lineup || lineup.length === 0) return { ok: false, error: 'empty lineup' };

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const oc = parseJsonPermissive(raw);

    // Create .bak backup
    const bakPath = OPENCLAW_CONFIG + '.bak';
    copyFileSync(OPENCLAW_CONFIG, bakPath);

    if (!oc.agents) oc.agents = {};
    if (!oc.agents.defaults) oc.agents.defaults = {};
    if (!oc.agents.defaults.model) oc.agents.defaults.model = {};

    // Primary = #1
    oc.agents.defaults.model.primary = `${lineup[0].provider}:${lineup[0].model}`;

    // Fallbacks = #2+
    oc.agents.defaults.model.fallbacks = lineup.slice(1).map(r => `${r.provider}:${r.model}`);

    writeFileSync(OPENCLAW_CONFIG, JSON.stringify(oc, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Parse JSON that might have trailing commas or other JSON5-isms
function parseJsonPermissive(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Strip trailing commas before } or ]
    const cleaned = raw.replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(cleaned);
  }
}
