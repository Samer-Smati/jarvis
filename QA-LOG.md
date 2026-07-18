# JARVIS QA Log

Living quality / gap log. Updated as we test, fix, and ship.

**Spec reference:** `jarvis-ai-assistant-spec.md`  
**App version under test:** 1.0.24 (source) — `release/` still has stale **1.0.23** (pre-Piper)  
**Last QA pass:** 2026-07-16 (final P0 Piper audit)

---

## How to use this file

- **PASS** — verified working in this pass  
- **PARTIAL** — works with gaps  
- **FAIL** — broken / blocked  
- **MISSING** — not built yet vs spec  
- **FIX APPLIED** — change landed in code  
- **TODO** — next improvement (priority tagged)

---

## 1. Live smoke (2026-07-16)

### P0 Piper plan — completion status

| Plan item | Code | Verified |
|-----------|------|----------|
| Backend `TtsService` + API routes | DONE | PASS (19 unit tests, 59 KB WAV synthesis) |
| `scripts/ensure-piper.js` + desktop boot | DONE | PASS (bootstrap + `runEnsurePiper` in `main.js`) |
| Frontend Piper WAV playback + prefetch | DONE | PASS (in `backend/public` build output) |
| `speakStreamPauseForTool` on `tool_end` | DONE | PASS (wired in `chat.component.ts`) |
| Settings Piper/Browser toggle + copy | DONE | PASS |
| `ensure-piper.js` in `electron-builder.json` | DONE | Not yet in shipped `release/` exe |
| QA §7 manual installer smoke | **NOT DONE** | Blocked — need fresh pack + manual run |

**Bottom line:** P0 **implementation is complete in source**. Shipped **`release/JARVIS-1.0.23-*.exe` does not include Piper** (built before merge). Repack to **1.0.24** failed at 13:20 — `release/win-unpacked` file lock (JARVIS still running).

### Re-check pass (post-Piper, same day)

| Check | Result | Notes |
|-------|--------|-------|
| Backend unit tests (19) | PASS | All suites green |
| `ensure-piper.js` bootstrap | PASS | Binary + `en_GB-alan-medium` model present locally |
| `TtsService.synthesize()` direct | PASS | 59–184 KB WAV for test phrases |
| Source: `voice.controller` TTS routes | PASS | `GET tts-status`, `POST synthesize` in `backend/dist` |
| Source: frontend Piper playback | PASS | `jarvis.ttsEngine`, prefetch queue, settings toggle |
| **`release/JARVIS-1.0.23-*.exe` pack contents** | **FAIL** | Pre-Piper build (12:09) — no `ensure-piper.js`, no TTS in bundled backend |
| Fresh pack (`desktop:pack:all` / `pack:fast`) | **BLOCKED** | Version bumped to 1.0.24; pack failed — close JARVIS, then `npm run desktop:pack:all` |

### Earlier smoke (still valid)

| Check | Result | Notes |
|-------|--------|-------|
| Backend `/api/status` on `:3847` | PASS | `lmstudio` + `qwen/qwen3.5-9b`, `llmReady: true` |
| Skills list | PASS | datetime, web_search, weather, reminders, calendar, files + stubs |
| Chat send when LM Studio offline | FIX APPLIED | Was `"fetch failed"` → auto-ensure LM Studio / Ollama on message |
| Chat send when LM Studio online | PASS | Status ready; activeRuns observed |
| Desktop `setup.exe` / portable pack (pipeline) | PASS | `desktop:pack:all` succeeds; **repack required** for Piper bits |
| Settings provider dropdown overlap | FIX APPLIED | `p-select` `appendTo="body"` |
| Voice sounds slow / robotic | FIX APPLIED | Piper neural TTS + browser fallback; soft pause on tool calls |
| Piper TTS `/api/voice/synthesize` | PASS | Local `en_GB-alan-medium` — 184 KB WAV test synthesis |
| Piper bootstrap (`ensure-piper.js`) | FIX APPLIED | GitHub `2023.11.14-2` + HuggingFace URLs; spawn from install dir |

---

## 2. Spec phase scorecard

| Phase | Spec goal | Status | Evidence / gap |
|-------|-----------|--------|----------------|
| **1** Core chat | LLM + tools + memory | **PASS** | Orchestrator + Socket.IO + SQLite history |
| **2** Voice | Wake word + STT + TTS | **PARTIAL** | STT + **Piper TTS** + **“Hey Jarvis” wake phrase** (browser); Porcupine offline TTS optional upgrade |
| **3** Persistent memory | Vector + facts + episodic | **PARTIAL** | Facts + episodic + embeddings in SQLite; not Chroma/pgvector |
| **4** Integrations | Email, calendar write, messaging | **PARTIAL** | Local + **Google Calendar** (env OAuth); **SMTP email**; **Home Assistant**; stubs removed for core skills |
| **4.5** Coding assistant | Gen/debug/GitHub/CI | **PARTIAL** | **Sandbox run** (JS/Python/shell); GitHub/CI still TODO |
| **5** Smart home / device | HA + PC control | **PARTIAL** | **Home Assistant** skill (REST); PC control still TODO |
| **6** Proactive | Briefings, conflict alerts | **PARTIAL** | Reminders + **8am morning briefing** (socket + TTS); conflict alerts TODO |
| **7** Polish | Custom voice, mobile, permissions | **PARTIAL** | Piper TTS; **PWA mobile** (`manifest.webmanifest`); native app TODO |

---

## 3. Feature inventory

### Working (PASS)

- Text chat with streaming tokens  
- Tool loop (max 8) + confirmation gate for stub skills that require it  
- Skills: `get_current_datetime`, `web_search`, `get_weather`, `manage_reminders`, `manage_calendar` (local), `read_files`  
- Memory: conversation, episodic events, `remember_fact`  
- Kill switch, provider switch (LM Studio / Ollama / Claude)  
- Auto-start local LLM on chat if offline (`EnsureLlmService`)  
- Desktop splash + pack (portable + NSIS)  
- Dashboard: status, reminders, audit, events, facts  
- Hands-free mic loop  
- **Piper neural TTS** (local `en_GB-alan-medium`) + browser fallback + prefetch queue  
- Settings Piper / Browser voice toggle  
- **Wake word** — “Hey Jarvis” via continuous browser speech (Settings toggle)  
- **Google Calendar** — list/create/move/delete when OAuth env set (`source: google|auto`)  
- **Email** — `send_email` via SMTP (confirmation gated)  
- **Coding sandbox** — `coding_assistant` run JS/Python/shell under `SANDBOX_ROOT`  
- **Smart home** — `smart_home` Home Assistant services API  
- **Morning briefing** — cron 8am → socket `morning_briefing` + spoken summary  
- **Mobile PWA** — installable web app; `GET /api/integrations/mobile`  

### Partial

| Item | Issue | Adjust |
|------|-------|--------|
| STT | Settings say Whisper; code prefers browser STT by default | **FIX APPLIED** — Whisper default; Settings mic engine toggle |
| Calendar | Local SQLite only; deletes not confirmation-gated | **PARTIAL** — delete/move now gated; Google/M365 still TODO |
| Proactive | Reminders only | Morning briefing job, calendar conflict alerts |
| Desktop install | `release/` 1.0.23 exe predates Piper; 1.0.24 repack blocked (file lock) | Close JARVIS → `npm run desktop:pack:all` → run §7 checklist |

### Missing (high value next)

1. ~~**Neural TTS** (Piper local or ElevenLabs) — #1 for “sounds like Siri”~~ **DONE (Piper)**  
2. **Wake word** (“Hey Jarvis”)  
3. Real **email** skill  
4. **Google / Microsoft calendar**  
5. **Coding sandbox + GitHub**  
6. **Home Assistant**  
7. Mobile client  
8. Rate limits / secrets vault  

---

## 4. Voice QA — robotic / slow (user report)

### Root cause

1. TTS uses browser `speechSynthesis` only (classic/robotic unless Windows “Natural Online” voice is selected).  
2. Old settings: `pitch: 0.88`, `rate: ~1.02` → slow, low, mechanical.  
3. Streaming flushed every ~28 characters → many tiny utterances with gaps (staccato).  

### Fix applied (2026-07-16) — Piper neural TTS

- Backend `TtsService` + `POST /api/voice/synthesize` + `GET /api/voice/tts-status`  
- `scripts/ensure-piper.js` downloads Piper binary (2023.11.14-2) + `en_GB-alan-medium` voice  
- Frontend plays WAV via `HTMLAudioElement` with prefetch queue; browser fallback if Piper offline  
- `speakStreamPauseForTool()` — tool calls no longer cut mid-phrase  
- Settings: Piper / Browser toggle + updated copy  

### Prior browser TTS tuning — `frontend/src/app/core/voice.service.ts`

- Prefer **Natural / Neural / Online** voices (Ryan, Sonia, Andrew, Aria, …).  
- Conversational rate **1.14**, pitch **1.0** (not robot-low).  
- Speak **full sentences / longer phrases** before first audio; merge short scraps in the queue.  
- Always use JARVIS voice path for streamed replies.  

### Still needed for true Siri-smooth

| Priority | Work |
|----------|------|
| ~~P0~~ | ~~Add **backend neural TTS** (Piper offline or ElevenLabs) + stream audio to UI~~ **DONE** |
| ~~P1~~ | ~~Don’t hard-cancel speech on every tool call; finish current phrase~~ **DONE** |
| P1 | Optional: speak final answer as one utterance when reply is short |
| P2 | Wake word + lower STT latency (streaming Whisper / always-on) |

**Windows tip for users now:** Settings → Time & language → Speech → install **Microsoft Online (Natural)** voices. JARVIS will pick them automatically.

---

## 5. Regression / packaging log

| Date | Issue | Fix |
|------|-------|-----|
| 2026-07-16 | No `setup.exe` after `desktop:pack:fast` | Expected: fast = `--dir` only; use `desktop:pack:setup` / `all` |
| 2026-07-16 | NSIS fail: recursive `node_modules/jarvis/...` | Removed `"jarvis": "file:.."`; exclude in prepare pack |
| 2026-07-16 | `app.asar` lock between portable + nsis | Single electron-builder run + fresh staging (`pack-all.js`) |
| 2026-07-16 | `"fetch failed"` on chat | LM Studio offline; `EnsureLlmService` + clearer errors |
| 2026-07-16 | Provider dropdown clipped | `appendTo="body"` |

---

## 6. Priority backlog (make it better and better)

### P0 — this week

- [x] Auto-ensure LLM on message  
- [x] Smoother browser TTS (rate/pitch/chunking/Natural voices)  
- [x] Neural TTS path (Piper local) — **code complete**  
- [ ] Ship + confirm end-to-end on **1.0.24** installer (close JARVIS, repack, run §7)

### P1 — Phase 2 complete

- [x] Wake word (“Hey Jarvis” — browser phrase detection)  
- [x] Align Whisper vs Fast STT with settings copy  
- [x] Google Calendar skill (OAuth refresh token in `.env`)  
- [x] Calendar delete/move confirmation (local SQLite)  

### P2 — Phase 4+

- [x] Email skill (SMTP)  
- [x] Coding assistant (sandbox run)  
- [x] Smart home (Home Assistant REST)  
- [x] Morning briefing (8am cron)  

### P3 — Phase 7

- [x] Mobile PWA foundation (manifest + mobile API)  
- [ ] Native mobile app (Flutter/RN)  
- [ ] Permission matrix UI  
- [ ] Cost / rate caps  

---

## 7. Manual test checklist (run after each pack)

1. Start JARVIS (setup or portable).  
2. Kill LM Studio → send “hello” → should auto-start model (may take 30–90s first time).  
3. Ask weather for Tunis → tool + spoken reply.  
4. Ask “what’s on my calendar today?” → local calendar skill.  
5. Toggle Voice Synthesis → **Test voice** → Piper neural (`en_GB-alan-medium`), smooth pace; browser fallback if Piper missing.  
6. Ask a tool-heavy question (weather + calendar) → speech should **not** cut mid-sentence on tool boundaries.  
7. Hands-free: speak a short question → reply → mic reopens.  
8. Settings: switch Ollama / LM Studio without UI clipping; Piper/Browser toggle works.  
9. Kill switch while a long reply streams.  

### Automated verification (2026-07-16 final)

| Check | Result |
|-------|--------|
| Backend unit tests (19) | PASS |
| Frontend `ng build` | PASS |
| `npm run build:desktop` (sync dist → pack input) | PASS |
| `ensure-piper.js` bootstrap | PASS |
| Direct `TtsService.synthesize()` | PASS |
| P0 Piper plan — all code items | **DONE** |
| Packed `release/JARVIS-1.0.23-*.exe` includes Piper | **FAIL** (stale) |
| Pack 1.0.24 with Piper | **BLOCKED** — `release/win-unpacked` locked |
| Manual checklist §7 (installer smoke) | **NOT RUN** — waiting on 1.0.24 pack |

---

## 8. Change log (code)

| Date | Area | Change |
|------|------|--------|
| 2026-07-16 | Pack | `pack-all.js`, staging output, remove recursive jarvis dep |
| 2026-07-16 | LLM | `EnsureLlmService`, clearer offline errors |
| 2026-07-16 | UI | Settings `p-select` overlay fix |
| 2026-07-16 | Voice | Siri-like browser TTS tuning (Natural voices, rate 1.14, sentence buffering) |
| 2026-07-16 | Voice | Piper TTS backend + frontend playback, ensure-piper bootstrap, soft tool speech pause |
| 2026-07-16 | QA | Re-check: source PASS; `release/` 1.0.23 exe stale (no Piper in bundle) — repack required |
| 2026-07-16 | QA | Final audit: P0 Piper code **DONE**; pack 1.0.24 blocked by file lock; §7 manual pending |
| 2026-07-16 | Voice | Whisper default STT + Settings mic toggle; calendar delete/move confirmation |
| 2026-07-16 | Integrations | Google Calendar, SMTP email, HA smart home, coding sandbox, morning briefing, PWA mobile |
| 2026-07-16 | Voice | Wake word “Hey Jarvis” (browser phrase detection) |
| 2026-07-16 | Security | Device permission prompts (browser, PC apps, phone); web tab-only scope + Settings comments |
| 2026-07-17 | Performance | Idle defaults off, async boot, LLM probe-only, deferred Piper, OnPush chat, diagnostics API |

---

## 10. Performance optimization (2026-07-17)

| Change | Status |
|--------|--------|
| Hands-free + wake word opt-in (default OFF) | DONE |
| App clock outside Angular CD + OnPush root | DONE |
| Async desktop boot; `/api/health` poll; backend first | DONE |
| `JARVIS_LLM_ENSURE=probe` (no auto Qwen load) | DONE |
| `JARVIS_DEFER_PIPER=1` + lazy ensure on first TTS | DONE |
| LLM `isReady()` 30s cache; reminder cron 60s + early exit | DONE |
| Whisper tiny default + 10 min idle unload | DONE |
| Lazy googleapis / Anthropic imports | DONE |
| Chat OnPush + token batching; lazy Socket.IO | DONE |
| Dashboard status poll 30s; details on load | DONE |
| Settings Performance mode + `/api/diagnostics` | DONE |
| Splash particles 40; stop rAF at 100% progress | DONE |

**Targets (JARVIS processes only):** time-to-UI &lt; 15s cold; idle CPU &lt; 5% with perf mode; backend idle RAM &lt; 120 MB before STT.

---

## 9. P1 / P2+ roadmap — implemented (2026-07-16)

| Item | Status | Configure |
|------|--------|-----------|
| **Wake word** | DONE (browser “Hey Jarvis”) | Settings → Voice → Wake word toggle; needs hands-free or idle resume |
| **Google Calendar** | DONE | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` in `.env` |
| **Email** | DONE (SMTP) | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` |
| **Coding sandbox** | DONE | `SANDBOX_ENABLED=true`, `SANDBOX_ROOT`; task `run` with `code` |
| **Smart home** | DONE | `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN` |
| **Morning briefing** | DONE | Automatic 8am; speaks via `morning_briefing` socket event |
| **Mobile** | PWA DONE | Add to home screen; `/api/integrations/mobile` |
| **Device permissions** | DONE | Desktop: browser / PC apps / phone prompts in chat + Settings; web: tab-only (see Settings HTML comment) |

**Still optional upgrades:** Porcupine offline wake word, Gmail OAuth (vs SMTP), GitHub/CI for coding, native mobile app.

**Recommended order after P0 ship:** Repack 1.0.24 → manual §7 → configure integrations in `.env` as needed.

---

*Append new QA findings under section 1 and update the scorecard when phases move.*
