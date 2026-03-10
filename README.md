# ⚾ OnDeckLLM

**Your AI Model Lineup Manager**

A localhost dashboard for managing LLM providers, model routing, and batting-order fallback chains. Auto-discovers providers from your [OpenClaw](https://openclaw.ai) config or works standalone.

## Features

- 🔍 **Auto-Discovery** — Detects Anthropic, OpenAI, Google AI, Ollama, and more from your OpenClaw config
- ⚾ **Batting Order** — Drag-and-drop model priority per task type (coding, chat, analysis)
- 🔌 **Provider Hub** — Add, test, and manage API keys for all major LLM providers
- 🔄 **Config Sync** — Push your model lineup back to OpenClaw with one click
- 📊 **Health Checks** — Live provider status with latency testing

## Install

```bash
npm install -g ondeckllm
```

## Usage

```bash
# Start the dashboard
ondeckllm

# Custom port
PORT=3901 ondeckllm
```

Then open [http://localhost:3900](http://localhost:3900)

## Providers Supported

| Provider | Auto-Discover | API Key | Local |
|----------|:---:|:---:|:---:|
| OpenAI | ✅ | ✅ | |
| Anthropic | ✅ | ✅ | |
| Google AI | ✅ | ✅ | |
| Groq | ✅ | ✅ | |
| Ollama | ✅ | | ✅ |
| Remote Ollama | ✅ | | ✅ |

## Works With

- **[OpenClaw](https://openclaw.ai)** — Auto-discovers providers from `~/.openclaw/openclaw.json`
- **Standalone** — Works without OpenClaw; manage providers manually

## Links

- 🌐 [ondeckllm.com](https://ondeckllm.com)
- ☕ [Ko-fi](https://ko-fi.com/ondeckllm)
- 🐛 [Issues](https://github.com/canonflip/ondeckllm/issues)

## License

MIT © [Canonflip](https://canonflip.com)
