<p align="center">
  <img src="assets/icon.png" width="128">
</p>

<h1 align="center">ELINO</h1>

<p align="center"><strong>Your AI companion, always by your side.</strong></p>

<p align="center">
  <a href="https://github.com/Tacky7788/Project-elino/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Tacky7788/Project-elino?style=flat&colorA=080f12&colorB=1fa669" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat&colorA=080f12&colorB=3b82f6" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-latest-blue?style=flat&colorA=080f12&colorB=47848F&logo=electron&logoColor=white" alt="Electron">
</p>

<p align="center">
  <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">中文</a>
</p>

---

ELINO is an AI companion that lives on your desktop — not in a browser tab.

It renders Live2D/VRM characters, connects to the LLM of your choice, and remembers you. Not just your last message, but conversations from weeks ago. It notices when you've been quiet and talks first. All memory stays on your machine.

> **Status:** Active development. [Issues](https://github.com/Tacky7788/Project-elino/issues) and [Discussions](https://github.com/Tacky7788/Project-elino/discussions) are welcome.

## Features

🧠 **Human-like memory** — Four-layer memory with hybrid BM25 + vector search. Forgetting curve, emotional weighting, pinned facts. [Details below](#memory-system).

🎭 **Live2D & VRM** — Both formats in one app. Switch anytime — memory and personality carry over.

💬 **Real emotions** — AI estimates emotion and automatically maps it to Live2D/VRM expressions and motion. *(WIP)*

👄 **Hybrid lip sync** — Phoneme timing × audio amplitude. Natural mouth movement for both model types.

🗣️ **Proactive speech** — Goes quiet? Your companion reaches out with something relevant, not random.

🎛️ **Multiple companions** — Character slots with independent memory, personality, and appearance.

🌱 **Self-growth** — Your companion learns from conversations and gradually changes its personality and speech style. Changes require your approval via confirmation dialog.

🎙️ **Voice conversation** — Talk with your mic, get spoken replies. Whisper STT + OpenAI TTS / VOICEVOX / browser TTS.

📡 **Streaming mode** — YouTube chat + OneComme. Your companion talks to your audience. *(WIP)*

🌐 **VRChat integration** — Chat with players in VRChat via OSC chatbox. *(WIP)*

⚡ **Claude Code integration** — Connect to a running CLI session for AI-powered dev.

## Memory System

ELINO's memory isn't a chat log. It's a layered retrieval system designed to work like human recall.

### Architecture

| Layer | What it stores |
|-------|---------------|
| **Facts** | Things you've shared — name, preferences, events |
| **Summaries** | Auto-generated conversation summaries |
| **Relationship** | Episodic records of how your bond has evolved |
| **Emotional State** | 6-axis internal state, persistent across sessions |

### Hybrid Retrieval

When recalling, ELINO runs **BM25 + vector search in parallel** and merges results via RRF (Reciprocal Rank Fusion). BM25 catches exact keywords; vector search catches meaning. Powered by `paraphrase-multilingual-MiniLM-L12-v2` — works across languages naturally.

### Forgetting Curve

Memories have a **retention score** that decays over time. Frequently recalled or emotionally significant memories decay slower. Important things stay. Trivial things fade. Like a person.

### Emotional State (6 axes)

Your companion continuously tracks:

| Axis | What it affects |
|------|----------------|
| **Valence** | Positive ↔ negative mood |
| **Arousal** | Energy level — calm vs. excited |
| **Dominance** | Assertive vs. tentative tone |
| **Trust** | How openly it speaks to you |
| **Curiosity** | Engagement — asks questions vs. passive |
| **Fatigue** | Response length and energy |

These shape how your companion speaks and behaves, persisting across sessions.

### Pinned Facts & Privacy

Pin critical memories so they never fade. All data stays in `%APPDATA%/elino/` — no cloud, no telemetry.

## Quick Start

```bash
git clone https://github.com/Tacky7788/Project-elino.git
cd elino
npm install
cp .env.example .env   # Add your API keys (or configure in-app)
npm run dev             # Start development mode
```

> First launch opens a setup wizard. Click the desktop character to chat. Settings in the system tray.

<details>
<summary><strong>Production & packaging</strong></summary>

```bash
npm run build && npm start   # Production
npm run pack                 # Create installer
```

</details>

### Requirements

- Node.js 18+
- npm

## Supported LLMs

| Provider | Models |
|----------|--------|
| Anthropic | Claude 4.5 / 4 / 3.5 |
| OpenAI | GPT-4o / 4.1 / o3 |
| Google | Gemini 2.5 / 2.0 |
| Groq | Llama, Mixtral (fast inference) |
| DeepSeek | DeepSeek-V3 / R1 |

## Models

| Format | Description |
|--------|-------------|
| `.model3.json` | Live2D Cubism 4 |
| `.vrm` | VRM 3D avatar |
| `.zip` | Either format, auto-extracted |

Use **Settings > Character > Browse** to select. On first launch, sample models are downloaded automatically.

**Where to find models:** [VRoid Hub](https://hub.vroid.com/) · [Live2D Samples](https://www.live2d.com/learn/sample/) · [Booth](https://booth.pm/)

> **Live2D SDK:** Required for Live2D models ([free download](https://www.live2d.com/sdk/download/web/), license agreement needed). The setup wizard handles this. VRM works without it.

## Settings

| Tab | Contents |
|-----|----------|
| LLM | Model, API keys, max tokens |
| Voice | STT/TTS engine, voice config |
| Character | Model type, window, FPS, resolution, lip sync |
| Personality | Name, presets, character slots |
| Proactive | Auto-speech frequency and triggers |
| Streaming | YouTube / OneComme integration *(WIP)* |
| Web Access | Browser access via localhost *(WIP)* |

<details>
<summary><strong>Project structure</strong></summary>

```
elino/
  main.cjs              # Electron main process
  preload.cjs           # IPC bridge
  src/
    core/               # Backend (brain, LLM, memory, TTS)
    renderer/           # Frontend (TypeScript)
      app.ts            # Chat UI
      character-live2d.ts
      character-vrm.ts
      settings.html     # Settings UI (8 tabs)
  public/
    live2d/models/      # Model files
    lib/                # Live2D SDK
```

</details>

<details>
<summary><strong>Data directory</strong></summary>

```
%APPDATA%/elino/companion/
  user.json             # User info
  settings.json         # App settings
  active.json           # Slot management
  slots/{slotId}/
    profile.json        # Character profile
    personality.json    # Personality config
    memory.json         # Memory data
    state.json          # Emotional state
    history.jsonl       # Conversation history
```

</details>

## Limitations

- Windows only (Electron + NSIS)
- Live2D SDK must be provided separately (proprietary license)

## Contributing

Contributions welcome! Open an issue or PR. Bug reports, feature ideas, translations, model compatibility fixes — all appreciated.

## License

[MIT](LICENSE)

---

<p align="center">If ELINO resonates with you, a ⭐ on the repo helps a lot.</p>
