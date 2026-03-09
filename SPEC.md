# OnDeckLLM — Product Spec
# Status: Planning → v1.0
# Owner: Canonflip (canonflip.com)
# License: MIT
# Working name — final name TBD

---

## Vision
Localhost dashboard for managing LLM providers, model routing, and usage analytics. Works standalone or with OpenClaw. Part of the Canonflip ecosystem alongside CloakClaw.

## Install
```bash
npm i -g ondeckllm
ondeckllm          # opens localhost:3900
```

## v1.0 Features

### 1. Provider Hub
- Add/remove LLM provider API keys
- One-click key validation (test connection, show available models, balance, rate limits)
- Supported: OpenAI, Anthropic, Google, Ollama, Groq, Mistral, DeepSeek, Together, OpenRouter
- Visual status indicators (green/yellow/red) per provider

### 2. Task Router
- Assign primary + fallback models per task type:
  - 💬 Chat/General
  - 💻 Coding
  - 🖼️ Images
  - 🎥 Video
  - 🔍 Research/RAG
  - 📊 Data/Analysis
- Drag-and-drop priority ordering
- Test button per route ("send test prompt to this model")

### 3. Pre-built Profiles
- One-click profile switching:
  - **Budget** — cheapest models first, local fallbacks
  - **Quality First** — best models regardless of cost
  - **Local Only** — Ollama models only, zero cloud
  - **Privacy Mode** — local + CloakClaw proxy for any cloud calls
  - **Speed Demon** — fastest response times first
- Custom profile creation + save/share

### 4. Cost+ Tracker
- Real-time spend per provider, per task type, per day/week/month
- Token counts (input/output per request)
- Response latency (avg, p95)
- Error rates & downtime per provider
- Fallback trigger frequency
- Daily/weekly/monthly trend charts
- "Health score" per provider (composite: cost + speed + reliability)
- Budget alerts ("You've spent $15 today on Anthropic")

### 5. Model Benchmark Scorecards
- Community-sourced ratings per task type
- Coding accuracy, creative writing, speed, cost-per-token
- Side-by-side comparison view
- Updated periodically from central feed

### 6. Affiliate Onboarding
- Guided setup for new providers
- "Need an Anthropic key? Sign up here" → referral link
- Revenue on every signup through affiliate programs
- Non-intrusive — only shown during provider setup flow

### 7. Config Sync (OpenClaw Integration)
- Reads/writes OpenClaw config (openclaw.json)
- Atomic writes — backup before every change
- Automatic rollback on failure
- Detects OpenClaw installation, shows connection status
- Changes reflect immediately in running agent

### 8. Usage Analytics
- Detailed breakdown dashboard:
  - Tokens consumed per model
  - Avg response time per model
  - Error rates per provider
  - Fallback triggers (which model, why)
  - Most-used models, least-used models
  - Cost efficiency rankings

### 9. Ollama Setup Wizard
- Auto-detect Ollama installation
- One-click install if missing (brew install ollama / curl)
- Browse available models with:
  - Description, parameter count, size on disk
  - Task ratings (good for coding? chat? images?)
  - Hardware requirements
- One-click model pull with progress bar
- Auto-configure as provider in OpenClaw
- Suggested starter packs:
  - "Essentials" — chat + coding + embeddings (3 models)
  - "Privacy Pack" — all local, no cloud needed
  - "Developer" — coding-focused selection

## v2.0 Features (Future)
- **Smart Recommendations** — analyze usage patterns, suggest cheaper/better models
- **A/B Testing Mode** — same prompt to 2 models, compare side-by-side
- **Model marketplace** — discover new models/providers
- **Team mode** — shared config across multiple agents
- **Webhook alerts** — notify on budget exceeded, provider down

## Ecosystem Integration
- **CloakClaw** — Privacy Mode profile auto-enables CloakClaw proxy
  - OnDeckLLM → CloakClaw proxy → Cloud LLM
  - Cross-promotion in both UIs and landing pages
- **OpenClaw** — Direct config sync, skill on ClawHub
- **Future Canonflip products** — shared affiliate/referral infrastructure

## Tech Stack
- Runtime: Node.js 20+
- Frontend: Lightweight (Preact or vanilla JS + CSS)
- Backend: Express or Fastify, localhost only
- Storage: Local JSON/SQLite (no external DB)
- Package: npm (global install)
- License: MIT
- Org: github.com/canonflip/ondeckllm

## Website (ondeckllm TBD domain)
- Dark theme, modern, developer-sexy
- Hero: animated dashboard mockup showing model routing in action
- "How it works" section: 3 steps (Install → Configure → Optimize)
- Live demo GIF/video of the dashboard
- Feature cards with icons for each major feature
- Provider logos grid (OpenAI, Anthropic, Google, Ollama, etc.)
- "Works with CloakClaw" integration badge + cross-link
- "Works with OpenClaw" badge
- Terminal install command with copy button
- Pricing: Free (open source) with affiliate-powered recommendations
- GitHub stars badge, npm downloads badge
- Built with: CF Pages (same as cloakclaw.com)

## Revenue Model
1. **Affiliate commissions** — LLM provider signups via referral links
2. **Premium features** (future) — advanced analytics, team mode
3. **Provider partnerships** — featured placement in provider hub
