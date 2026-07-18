# J.A.R.V.I.S — Personal AI Assistant

Iron Man–style personal AI: voice-first HUD, tool calling, calendar, weather, memory, and multilingual support (English, French, Tunisian Arabic / Derja, and more).

Built from [jarvis-ai-assistant-spec.md](jarvis-ai-assistant-spec.md).

| Folder | Role |
|--------|------|
| `backend/` | NestJS — agent loop, skills, memory, WebSocket, Whisper STT |
| `frontend/` | Angular 19 + PrimeNG — Iron Man HUD (chat, dashboard, settings) |
| `desktop/` | Electron wrapper for Windows `.exe` |
| `scripts/` | Boot helpers (`ensure-ai`, copy frontend, wait for backend) |

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) |
| **LM Studio** (recommended) | [lmstudio.ai](https://lmstudio.ai) — local brain, default provider |
| **Ollama** (optional fallback) | [ollama.com](https://ollama.com) — faster smaller models |
| **Windows 10/11** | Desktop `.exe` built for Windows x64 |

Optional: **Anthropic API key** if you switch provider to Claude in Settings.

---

## First-time install

Run once from the project root (`javis/`):

```powershell
# 1. Install all dependencies
npm install
npm install --prefix backend
npm install --prefix frontend

# 2. Backend environment
copy .env.example backend\.env

# 3. Install LM Studio CLI models (if using LM Studio)
#    Open LM Studio app OR use CLI:
lms server start
lms load qwen/qwen3.5-9b
```

---

## How to run JARVIS

### Option A — One command (recommended)

Auto-starts LM Studio, loads `qwen/qwen3.5-9b`, then backend + frontend:

```powershell
npm run dev
```

Open **http://localhost:4200** — Iron Man HUD with voice.

If LM Studio is **already running** with a model loaded:

```powershell
npm run dev:quick
```

### Option B — Boot AI only (LM Studio)

```powershell
npm run boot
```

Starts LM Studio server and loads the chat model if needed. Then run backend + frontend separately or use the `.exe`.

### Option C — Manual (two terminals)

**Terminal 1 — backend**

```powershell
cd backend
npm run start:dev
```

**Terminal 2 — frontend**

```powershell
cd frontend
npm start
```

Backend: **http://localhost:3000** · Frontend: **http://localhost:4200**

### Option D — Windows desktop app (`.exe`)

**Run without installing (portable):**

```powershell
# Build once
npm run desktop:pack

# Then double-click:
release\JARVIS-1.0.0-portable.exe
```

Or installer: `release\JARVIS-1.0.0-setup.exe`

**Dev desktop window (from source):**

```powershell
npm run desktop:dev
```

Desktop app notes:

- Bundles backend + HUD in one window (no browser tabs).
- **LM Studio must still be running** for the AI brain (`npm run boot` first).
- Data stored in `%APPDATA%\jarvis\` (SQLite, calendar, memory, Whisper cache).

### Option E — Docker

```powershell
docker compose up --build
```

Uses Ollama inside Docker (see `docker-compose.yml`).

---

## All npm scripts

Run from project **root**:

| Command | What it does |
|---------|----------------|
| `npm run dev` | Boot LM Studio → backend + frontend |
| `npm run dev:quick` | Backend + frontend only (no LM Studio boot) |
| `npm run boot` | Start LM Studio + load chat model |
| `npm run backend` | Backend watch mode only |
| `npm run frontend` | Angular dev server only |
| `npm run build` | Production build backend + frontend |
| `npm run build:desktop` | Build for Electron (UI served by backend) |
| `npm run desktop:dev` | Build + open Electron window |
| `npm run desktop:pack` | Build Windows `.exe` in `release/` |
| `npm test` | Backend unit tests |

Backend only (`cd backend`):

| Command | What it does |
|---------|----------------|
| `npm run start:dev` | NestJS watch (runs `ensure-ai` via prestart) |
| `npm run start:prod` | Run compiled `dist/main.js` |
| `npm run build` | Compile TypeScript |

---

## AI models on your PC

Configured for **your machine** in `backend/.env`:

| Runtime | Model | Size | Role |
|---------|-------|------|------|
| **LM Studio** | `qwen/qwen3.5-9b` | 6.55 GB | **Primary brain** — smartest, tool calling |
| **LM Studio** | `text-embedding-nomic-embed-text-v1.5` | 84 MB | Semantic memory embeddings |
| **Ollama** | `llama3.2` | 2 GB | **Fallback** — faster on 4 GB GPU |

### LM Studio commands

```powershell
lms ls                          # list installed models
lms server start                # start API on port 1234
lms load qwen/qwen3.5-9b        # load chat model
lms ps                          # show loaded models
lms unload qwen/qwen3.5-9b      # free VRAM
```

### Switch to Ollama (faster replies)

1. Start Ollama: `ollama serve`
2. Ensure model: `ollama pull llama3.2`
3. In **Protocols** (Settings UI) pick **Ollama**, or set in `backend/.env`:

```env
LLM_PROVIDER=ollama
OLLAMA_CHAT_MODEL=llama3.2
EMBED_PROVIDER=ollama
```

4. Restart JARVIS.

### Switch to Claude (cloud)

```env
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Configuration (`backend/.env`)

Copy from root: `copy .env.example backend\.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `lmstudio` | `lmstudio` \| `ollama` \| `claude` |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | LM Studio OpenAI-compatible API |
| `LMSTUDIO_CHAT_MODEL` | `qwen/qwen3.5-9b` | Chat model id |
| `LMSTUDIO_EMBED_MODEL` | `text-embedding-nomic-embed-text-v1.5` | Embeddings for memory |
| `EMBED_PROVIDER` | `lmstudio` | `lmstudio` \| `ollama` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API |
| `OLLAMA_CHAT_MODEL` | `llama3.2` | Ollama chat model |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Ollama embeddings |
| `ANTHROPIC_API_KEY` | — | Required for Claude |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Claude model id |
| `DATABASE_PATH` | `data/jarvis.sqlite` | SQLite database |
| `FILES_ROOT` | `data/files` | Sandboxed filesystem skill |
| `PORT` | `3000` | Backend HTTP + WebSocket |
| `CORS_ORIGIN` | `http://localhost:4200` | Allowed frontend origin |
| `WHISPER_MODEL` | `Xenova/whisper-small` | Local STT (~150 MB download first use) |
| `TRANSFORMERS_CACHE` | `data/whisper-cache` | Whisper model cache |

---

## Voice & languages

JARVIS speaks and listens in **any language** — English, French, **Tunisian Arabic (Derja)**, standard Arabic, etc.

| Feature | How |
|---------|-----|
| **Mic (STT)** | Records audio → backend **Whisper** (auto-detects language). Falls back to browser speech if Whisper unavailable. |
| **Voice (TTS)** | Browser reads replies aloud; picks Arabic/French/English voice when possible. |
| **Reply language** | JARVIS matches the language you use. |
| **Hands-free** | Toggle **HANDS-FREE** in chat — mic reopens after JARVIS finishes speaking. |

First mic use: Whisper downloads once (~150 MB, needs internet). Allow 10–30 seconds on first transcription.

---

## What JARVIS can do (skills)

| Skill | Status | Examples |
|-------|--------|----------|
| `get_weather` | Live | "What's the weather in Tunis?" / "شنوة الطقس في تونس؟" |
| `manage_calendar` | Live | "Check my calendar" / "Add meeting tomorrow at 3pm" |
| `manage_reminders` | Live | "Remind me at 6pm to call Sami" |
| `web_search` | Live | "Search for latest Node.js LTS" |
| `get_current_datetime` | Live | "What time is it?" |
| `read_files` | Live | Read files in `data/files/` |
| `remember_fact` | Live | Stores long-term user facts |
| `send_email` | Stub | Offers to draft text instead |
| `coding_assistant` | Stub | Code help in conversation |
| `smart_home` | Stub | Planned |
| `media_control` | Stub | Planned |

**Dashboard** (`/dashboard`): system status, neural core online/offline, reminders, audit log, memory facts.

**Protocols** (`/settings`): switch LLM provider, toggle skills, kill switch, test voice.

---

## Using the UI

1. Open **http://localhost:4200** (browser) or the **desktop `.exe`**.
2. **Mic** — speak in any language; stop when done (or use hands-free).
3. **Type** — optional text in the composer.
4. **Voice toggle** — mute/unmute JARVIS speech.
5. **HANDS-FREE** — continuous voice conversation loop.

Example prompts:

- "What's the weather in Tunis right now?"
- "Check my calendar for this week."
- "شنوة الطقس في تونس؟"
- "Add a standup tomorrow at 10am."
- "Remind me in 30 minutes to take a break."

---

## Troubleshooting

### `fetch failed` / JARVIS won't reply

**Cause:** LM Studio not running on port 1234.

**Fix:**

```powershell
npm run boot
# or manually:
lms server start
lms load qwen/qwen3.5-9b
```

Check: open http://localhost:1234/v1/models — should list `qwen/qwen3.5-9b`.

Dashboard → **Neural core** should show **online** with model name.

### Replies very slow (60–120 seconds)

**Cause:** `qwen3.5-9b` (6.55 GB) doesn't fit fully on a 4 GB GPU; runs partly on CPU.

**Fix (pick one):**

- Switch to **Ollama `llama3.2`** in Settings (fastest on your hardware).
- Download a **3B model** in LM Studio (e.g. `qwen2.5-3b-instruct`) and set `LMSTUDIO_CHAT_MODEL`.
- In LM Studio: disable thinking mode for qwen3.5; keep model loaded (disable auto-unload).

### Mic / Whisper not working

- First use needs **internet** to download Whisper.
- If transcribe fails, mic falls back to **browser STT** (English-biased).
- After `npm run desktop:pack`, run `npm install --prefix backend` to restore dev dependencies if backend won't compile.

### Two voices at once

Close extra browser tabs on `localhost:4200`. Only one client should be open (or use desktop `.exe` only).

### Backend won't start after desktop pack

```powershell
cd backend
npm install
npm run start:dev
```

`desktop:pack` runs `npm prune --omit=dev` — reinstall restores TypeScript dev tools.

### Smoke test (API)

```powershell
cd backend
node scripts/skill-smoke.js "What's the weather in Tunis?"
```

---

## Architecture (short)

- **Orchestrator** — LLM agent loop, streaming tokens over WebSocket, tool calling.
- **Skills** — pluggable tools (weather, calendar, reminders, …).
- **Memory** — conversation history, episodic log, semantic facts (embeddings in SQLite).
- **Guardrails** — confirmation for sensitive actions, audit log, kill switch.
- **Scheduler** — fires due reminders proactively.

---

## Project layout

```
javis/
├── backend/           NestJS API + WebSocket + Whisper
├── frontend/          Angular Iron Man HUD
├── desktop/           Electron main process
├── scripts/
│   ├── ensure-ai.js       Boot LM Studio / detect models
│   ├── copy-frontend.js   Copy Angular build → backend/public
│   └── wait-backend.js    Frontend waits for API
├── release/           Built .exe files (after desktop:pack)
├── package.json       Root scripts (npm run dev, desktop:pack)
├── .env.example       Template → copy to backend/.env
└── docker-compose.yml Docker stack
```

---

## Roadmap

See [jarvis-ai-assistant-spec.md](jarvis-ai-assistant-spec.md) — email, smart home, full coding agent, Telegram/WhatsApp, LiveKit for production voice latency.

---

## Quick reference card

```powershell
# First time
npm install && npm install --prefix backend && npm install --prefix frontend
copy .env.example backend\.env

# Every day — browser
npm run dev

# Every day — desktop exe
npm run boot
release\JARVIS-1.0.0-portable.exe

# Rebuild exe
npm run desktop:pack
```
