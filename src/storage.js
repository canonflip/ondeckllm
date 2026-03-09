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
    taskRoutes: {
      chat: [],
      coding: [],
      images: [],
      video: [],
      research: [],
      data: []
    },
    activeProfile: null,
    profiles: {
      budget: {
        name: 'Budget',
        description: 'Cheapest models first, local fallbacks',
        icon: '\u{1F4B0}',
        taskRoutes: {
          chat: [
            { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            { provider: 'deepseek', model: 'deepseek-chat' },
            { provider: 'ollama', model: 'llama3.2' }
          ],
          coding: [
            { provider: 'deepseek', model: 'deepseek-coder' },
            { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            { provider: 'ollama', model: 'codellama' }
          ],
          images: [
            { provider: 'openai', model: 'dall-e-2' }
          ],
          video: [],
          research: [
            { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            { provider: 'deepseek', model: 'deepseek-chat' }
          ],
          data: [
            { provider: 'deepseek', model: 'deepseek-chat' },
            { provider: 'groq', model: 'llama-3.3-70b-versatile' }
          ]
        }
      },
      quality: {
        name: 'Quality First',
        description: 'Best models regardless of cost',
        icon: '\u{1F451}',
        taskRoutes: {
          chat: [
            { provider: 'anthropic', model: 'claude-opus-4-6' },
            { provider: 'openai', model: 'gpt-4o' },
            { provider: 'google', model: 'gemini-2.0-pro' }
          ],
          coding: [
            { provider: 'anthropic', model: 'claude-opus-4-6' },
            { provider: 'openai', model: 'o3' },
            { provider: 'deepseek', model: 'deepseek-coder' }
          ],
          images: [
            { provider: 'openai', model: 'dall-e-3' },
            { provider: 'google', model: 'imagen-3' }
          ],
          video: [
            { provider: 'google', model: 'veo-2' }
          ],
          research: [
            { provider: 'openai', model: 'o3' },
            { provider: 'anthropic', model: 'claude-opus-4-6' },
            { provider: 'google', model: 'gemini-2.0-pro' }
          ],
          data: [
            { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
            { provider: 'openai', model: 'gpt-4o' }
          ]
        }
      },
      local: {
        name: 'Local Only',
        description: 'Ollama models only, zero cloud calls',
        icon: '\u{1F3E0}',
        taskRoutes: {
          chat: [
            { provider: 'ollama', model: 'llama3.2' },
            { provider: 'ollama', model: 'mistral' }
          ],
          coding: [
            { provider: 'ollama', model: 'codellama' },
            { provider: 'ollama', model: 'deepseek-coder-v2' }
          ],
          images: [],
          video: [],
          research: [
            { provider: 'ollama', model: 'llama3.2' },
            { provider: 'ollama', model: 'mixtral' }
          ],
          data: [
            { provider: 'ollama', model: 'llama3.2' },
            { provider: 'ollama', model: 'mistral' }
          ]
        }
      },
      privacy: {
        name: 'Privacy Mode',
        description: 'Local models + CloakClaw proxy for cloud calls',
        icon: '\u{1F512}',
        taskRoutes: {
          chat: [
            { provider: 'ollama', model: 'llama3.2' },
            { provider: 'ollama', model: 'mistral' }
          ],
          coding: [
            { provider: 'ollama', model: 'codellama' },
            { provider: 'ollama', model: 'deepseek-coder-v2' }
          ],
          images: [],
          video: [],
          research: [
            { provider: 'ollama', model: 'llama3.2' }
          ],
          data: [
            { provider: 'ollama', model: 'llama3.2' }
          ]
        }
      },
      speed: {
        name: 'Speed Demon',
        description: 'Fastest response times first',
        icon: '\u26A1',
        taskRoutes: {
          chat: [
            { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
            { provider: 'openai', model: 'gpt-4o-mini' }
          ],
          coding: [
            { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
            { provider: 'deepseek', model: 'deepseek-coder' }
          ],
          images: [
            { provider: 'openai', model: 'dall-e-3' }
          ],
          video: [],
          research: [
            { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }
          ],
          data: [
            { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            { provider: 'openai', model: 'gpt-4o-mini' }
          ]
        }
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
    return { ...defaults, ...config, profiles: { ...defaults.profiles, ...config.profiles } };
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

export function getTaskRoutes() {
  const config = loadConfig();
  return config.taskRoutes;
}

export function setTaskRoutes(routes) {
  const config = loadConfig();
  config.taskRoutes = routes;
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
    config.taskRoutes = JSON.parse(JSON.stringify(config.profiles[profileId].taskRoutes));
  }
  saveConfig(config);
}

export function getProfiles() {
  const config = loadConfig();
  return config.profiles;
}

// ── OpenClaw Config Integration ──

export function readOpenClawConfig() {
  const result = { providers: {}, models: {}, agents: {} };
  try {
    if (existsSync(OPENCLAW_CONFIG)) {
      const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
      const oc = JSON.parse(raw);
      result.providers = oc.models?.providers || {};
      result.agents = oc.agents?.defaults || {};
      result.auth = oc.auth || {};
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

export function writeOpenClawConfig(taskRoutes) {
  if (!existsSync(OPENCLAW_CONFIG)) return { ok: false, error: 'openclaw.json not found' };

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const oc = JSON.parse(raw);

    // Create .bak backup
    const bakPath = OPENCLAW_CONFIG + '.bak';
    copyFileSync(OPENCLAW_CONFIG, bakPath);

    // Map coding task routes to agents.defaults.model
    const codingRoutes = taskRoutes.coding || [];
    if (codingRoutes.length > 0) {
      if (!oc.agents) oc.agents = {};
      if (!oc.agents.defaults) oc.agents.defaults = {};
      if (!oc.agents.defaults.model) oc.agents.defaults.model = {};

      // Primary = #1
      const primary = codingRoutes[0];
      oc.agents.defaults.model.primary = `${primary.provider}:${primary.model}`;

      // Fallbacks = #2+
      if (codingRoutes.length > 1) {
        oc.agents.defaults.model.fallbacks = codingRoutes.slice(1).map(r => `${r.provider}:${r.model}`);
      } else {
        oc.agents.defaults.model.fallbacks = [];
      }
    }

    writeFileSync(OPENCLAW_CONFIG, JSON.stringify(oc, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
