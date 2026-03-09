<p align="center">
  <img src="assets/icon.png" width="128">
</p>

<h1 align="center">ELINO</h1>

<p align="center">Your AI companion, always by your side.</p>

<p align="center">
  <a href="https://github.com/Tacky7788/Project-elino/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Tacky7788/Project-elino?style=flat&colorA=080f12&colorB=1fa669" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat&colorA=080f12&colorB=3b82f6" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-latest-blue?style=flat&colorA=080f12&colorB=47848F&logo=electron&logoColor=white" alt="Electron">
</p>

<p align="center">
  <a href="README.ja.md">日本語</a>
</p>

---

Imagine an AI character living on your desktop -- one that remembers your conversations from weeks ago, and occasionally talks to you just because it noticed you've been quiet for a while.

ELINO is a desktop companion built on Electron. It renders Live2D or VRM models directly on your desktop, connects to the LLM of your choice, and develops a persistent memory of who you are. It's not a chatbot in a browser tab. It's something that stays with you.

## What Makes ELINO Different

**Dual model rendering** -- Live2D and VRM side by side in the same app. Pick whichever format you prefer, or switch between them.

**Real emotions** -- ELINO reads the tone of your conversation and maps it to facial expressions and body motions in real time. Not scripted reactions, but contextual ones.

**Memory that persists** -- Facts you share, summaries of past conversations, the evolving relationship between you and your companion. All stored locally, all managed automatically.

**It talks first** -- Proactive speech means your companion will initiate conversation during periods of silence. Not random noise, but contextual remarks based on what it knows about you.

**Multiple personalities** -- Character slots let you create and switch between entirely different companions, each with their own memory, personality, and appearance.

**Your voice, your choice** -- Whisper for speech recognition, OpenAI TTS / VOICEVOX / browser TTS for output. Full voice I/O without locking you into one provider.

**Goes live with you** -- Streaming mode reads YouTube chat (and other platforms via OneComme), letting your companion interact with your audience. (WIP)

**VRChat-ready** -- OSC-based lip sync and expression control for bringing your companion into VRChat.

**Claude Code integration** -- Connect directly to a running Claude Code CLI session for an AI-powered development workflow.

## Quick Start

### Requirements

- Node.js 18+
- npm

### Install and run

```bash
git clone https://github.com/Tacky7788/Project-elino.git
cd elino
npm install
```

Copy `.env.example` to `.env` and add your API keys (you can also set them from the in-app settings).

```bash
cp .env.example .env
```

```bash
# Development
npm run dev

# Production
npm run build && npm start

# Create installer
npm run pack
```

### First launch

On first launch, a setup wizard will guide you through the initial configuration. Click the character on your desktop to open the chat window. Access settings from the system tray.

## Supported LLMs

- Anthropic (Claude)
- OpenAI
- Google (Gemini)
- Groq
- DeepSeek

## Models

Use the **Browse** button in Settings > Character to select model files.

| Format | Description |
|--------|-------------|
| `.model3.json` | Live2D Cubism 4 model |
| `.vrm` | VRM 3D avatar |
| `.zip` | Archive containing either format (auto-extracted) |

### Where to find models

- [VRoid Hub](https://hub.vroid.com/) -- Free VRM models (check individual licenses)
- [Live2D Sample Models](https://www.live2d.com/learn/sample/) -- Official samples
- [Booth](https://booth.pm/) -- Community-made Live2D and VRM models

### Live2D SDK

Live2D rendering requires the [Cubism SDK for Web](https://www.live2d.com/sdk/download/web/) (free, license agreement required). The first-launch setup screen handles this. VRM models work without it.

## Data

All user data is stored locally in `%APPDATA%/elino/companion/`.

<details>
<summary>Directory structure</summary>

```
companion/
  user.json           # User info
  settings.json       # App settings
  active.json         # Slot management
  slots/
    {slotId}/
      profile.json    # Character profile
      personality.json # Personality settings
      memory.json     # Memory data
      state.json      # State
      history.jsonl   # Conversation history
```

</details>

## Architecture

<details>
<summary>Project structure</summary>

```
elino/
  main.cjs            # Electron main process
  preload.cjs         # IPC bridge
  src/
    core/             # Backend (brain, LLM, memory, TTS, etc.)
    renderer/         # Frontend (TypeScript)
      app.ts          # Chat UI
      character.ts    # Character window entry
      character-live2d.ts
      character-vrm.ts
      settings.html   # Settings UI
  public/
    live2d/models/    # Model files (auto-downloaded or user-provided)
    lib/              # Live2D SDK (user-provided)
```

</details>

## Settings

| Tab | Contents |
|-----|----------|
| LLM | Model selection, API keys, max tokens |
| Voice | STT/TTS engine, voice settings |
| Character | Model type, window size, FPS, resolution, model path |
| Personality | Name, presets, character slot management |
| Proactive | Auto-speech frequency and conditions |
| Streaming | YouTube / OneComme comment integration (WIP) |
| Web Access | Browser access via local server (WIP) |

## Limitations

- Windows only (Electron + NSIS installer)
- Live2D SDK must be provided separately (proprietary license)

## License

[MIT](LICENSE)
