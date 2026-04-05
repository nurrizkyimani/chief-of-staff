
# M4/W1/D5 - Sun, 5 Apr 26
## OpenClaw Receipt Assistant - Local Flow, Hook Flow, and Real Code Path

### What We Clarified
- If we run OpenClaw locally, yes: it can receive Telegram messages locally, call model parsing (OpenAI), produce structured JSON, and then write that JSON result into Google Sheets.
- OpenClaw does not need Kafka/Redis for this flow by default.
- The hook handler (example: `parseReceipt()`) is called by OpenClaw runtime events, not by manually typing function calls in CLI.
- CLI is mostly for setup/config/run commands; runtime message processing is done by the gateway/channel process.

### End-to-End Flow (Simple)
1. Telegram sends update to your local OpenClaw process.
2. OpenClaw normalizes message context (`Body`, `RawBody`, `CommandBody`, `SessionKey`, `MessageSid`, etc).
3. OpenClaw emits internal event `message:received`.
4. Your hook handler (registered from `HOOK.md` + `handler.ts`) runs.
5. Handler calls OpenAI (`gpt-4.1-mini`) to parse receipt image/text into standard JSON.
6. Handler validates/normalizes fields (merchant, total, tax/PB1/PPN, date, category).
7. Handler appends one row to Google Sheet raw tab.
8. Monthly summary tab in the same spreadsheet updates via formulas/pivot.

### How OpenClaw Actually Calls Hooks
- Hooks are loaded at startup from discovered hook folders.
- OpenClaw registers handlers by event key such as:
  - `message`
  - `message:received`
  - `message:preprocessed`
  - `message:transcribed`
  - `message:sent`
- At runtime OpenClaw calls:
  - `createInternalHookEvent(...)`
  - `triggerInternalHook(...)`
- Your hook executes when event key matches what you declared.

### Event System Explained (Node.js Mental Model)
- This is an in-process event dispatch system inside OpenClaw (Node.js), not Kafka.
- Node.js gives async concurrency through the event loop.
- In OpenClaw hook bus:
  - one `triggerInternalHook(event)` call awaits handlers in registration order.
  - errors in one handler are caught and logged, then next handler still runs.
- Some hook triggers are wrapped as fire-and-forget, so main reply flow can continue without waiting full hook completion.

### "Is It Pipeline + Workers Like Goroutine?"
- Conceptually yes, you can think of a pipeline.
- Implementation-wise it is Node async + promises, not Go channels/goroutines.
- Parallelism/concurrency comes from async I/O and non-blocking operations, not native goroutines.

### File-to-File Real Code Path (OpenClaw)
```text
extensions/telegram/src/monitor.ts
  -> TelegramPollingSession.runUntilAbort()
  -> bot.on("message", ...) in bot-handlers.runtime.ts
  -> processInboundMessage(...)
  -> build ctxPayload via finalizeInboundContext(...) in bot-message-context.session.ts
  -> dispatchReplyWithBufferedBlockDispatcher(...) in bot-message-dispatch.ts
  -> dispatchReplyFromConfig(...) in core reply pipeline
  -> triggerInternalHook(createInternalHookEvent("message","received",...))
  -> your registered hook handler executes
```

### Runtime vs CLI
- Runtime (auto):
  - receives Telegram update
  - creates event payload
  - dispatches hooks
  - sends replies
- CLI (manual):
  - run/start gateway
  - configure channels/hooks
  - inspect status/logs
- CLI does not manually invoke `parseReceipt()` for normal message handling.

### Example Internal Event Payload Shape
```json
{
  "type": "message",
  "action": "received",
  "sessionKey": "agent:main:telegram:direct:123456",
  "timestamp": "2026-04-05T00:00:00.000Z",
  "context": {
    "from": "telegram:123456",
    "content": "receipt image/text",
    "channelId": "telegram",
    "accountId": "default",
    "conversationId": "telegram:123456",
    "messageId": "987654",
    "metadata": {}
  },
  "messages": []
}
```

### For Receipt Assistant (M1) in This Architecture
- Model: OpenAI `gpt-4.1-mini`.
- Output JSON fields: restaurant/merchant, total, tax (PPN/PB1/service), date, classification.
- Classification set for M1:
  - `food`
  - `mobility`
  - `groceries`
  - `nonfood`
  - `subscription`
- Google Sheets:
  - raw tab (`receipts_raw`) receives one parsed receipt per row.
  - monthly tab in same spreadsheet summarizes totals by month/category.

### Real OpenClaw References We Checked
- Telegram polling boot:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/extensions/telegram/src/monitor.ts#L235-L250
- Telegram inbound message event:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/extensions/telegram/src/bot-handlers.runtime.ts#L1788-L1822
- Telegram inbound context payload:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/extensions/telegram/src/bot-message-context.session.ts#L256-L318
- Telegram dispatch into core:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/extensions/telegram/src/bot-message-dispatch.ts#L603-L609
- Core emits internal `message:received`:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/auto-reply/reply/dispatch-from-config.ts#L443-L453
- Internal hook types + event interface:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/hooks/internal-hooks.ts#L16-L17
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/hooks/internal-hooks.ts#L174-L187
- Internal hook dispatch function:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/hooks/internal-hooks.ts#L289-L306
- Hook discovery from `HOOK.md` + handler files:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/hooks/workspace.ts#L89-L122
- Hook loading/registration at startup:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/gateway/server-startup.ts#L135-L179
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/hooks/loader.ts#L61-L139
- Fire-and-forget helper used by message hooks:
  - https://github.com/openclaw/openclaw/blob/b63557679e85e4aa7506ec597235821968a9ec95/src/hooks/fire-and-forget.ts#L3-L10

### Final Practical Answer
Yes, your local setup can do exactly this sequence:
Telegram message/image -> local OpenClaw receives -> hook runs -> OpenAI parses to JSON -> JSON appended to Google Sheet.


# M4/W1/D3 - Fri, 3 Apr 26
## OpenClaw Home Brain - Reddit 
https://www.reddit.com/r/openclaw/comments/1s0ywz6/i_gave_my_home_a_brain_heres_what_50_days_of/
I gave my home a brain. Here's what 50 days of self-hosted AI looks like. Built an AI that wakes me up, cleans my house, tracks my spending, and judges my sleep. It's self-hosted and it rules.

Hey everyone! I've been running a self-hosted AI assistant called **G-Bot** for about 50 days, built on top of [OpenClaw](https://github.com/openclaw/openclaw). It started as a simple Telegram chatbot and grew into something that manages my home, tracks my finances, monitors my health, and knows who I am. Here's the full breakdown.

**Stats at a glance:** 12+ LLMs · 9 Docker containers · 23 monitored services · 1,078 memory chunks · running 24/7

### 🧠 The Core

G-Bot runs on a Linux VM and I talk to it exclusively via **Telegram**. Every message flows through an OpenClaw Gateway running as a systemd user service.

The default model is **GLM-5** (Ollama cloud relay), but it picks the right model per task:

- **Kimi K2.5** — complex reasoning, long context
    
- **Claude Sonnet** — intricate coding tasks
    
- **MiniMax M2.7** — voice morning briefings
    
- **GLM4-Flash** — lightweight background tasks
    

It's also fully bilingual (French/English) — I code-switch mid-sentence and it just follows.

**Example prompts:**

> _"Give me a morning briefing — news, weather, calendar, and an AI project idea"_
> 
> _"What did I spend on restaurants this month?"_
> 
> _"Tu te souviens comment on a fixé le bug du Roborock?"_ (it remembers 😄)

---

### 🏠 Home Automation

Everything routes through **Home Assistant** (Docker). Devices connected:

- **Roborock S7 Max Ultra** — room-by-room cleaning via segment IDs
    
- **Philips Hue** — sunrise/sunset automations
    
- **Govee H5100 thermometers** — 3 rooms + outdoor, data every 5min → InfluxDB
    
- **Tapo C225 camera** — RTSP snapshots via ffmpeg + ONVIF pan/tilt, sends photos to Telegram on request
    
- **Google Nest Hub 2** — TTS + photo slideshows (Immich Kiosk) + AI news slides via DashCast
    
- **VeSync Humidifier** — humidity control
    
- **NVIDIA Shield** — ADB control for URL casting
    
- **Sonos** — voice-controlled music
    

> ⚠️ Hard-learned lesson: `app_segment_clean` on the Roborock silently resets mop intensity on every call. Cost me a full manual map restore. Always set mop settings + `sleep 15` before launching. The API docs don't mention this anywhere.

**Example prompts:**

> _"Cast my photos on the Hub"_
> 
> _"Show me the cats on the camera"_
> 
> _"What's the temperature in the bedroom right now?"_
> 
> _"Clean the kitchen and bathroom"_
> 
> _"Play my Spotify playlist on the Sonos"_
> 
> _"Movie mode — dim the lights"_

---

### 💰 Finance Tracking

Full **Firefly III** setup with automatic bank sync:

- **SimpleFIN Bridge** syncing 13 accounts (checking, credit cards, savings, RRSP, LIRA, TFSA) 2x/day
    
- 65+ auto-categorization rules
    
- 4 budgets with monthly limits
    
- Custom Python pushing everything to **InfluxDB → Grafana** (spending dashboard + retirement portfolio evolution)
    

**Example prompts:**

> _"How much did I spend on restaurants this month?"_
> 
> _"Am I over budget on AI tools?"_
> 
> _"Summarize my top 5 expense categories for Q1 2026"_
> 
> _"How is my retirement portfolio performing since last month?"_

---

### 🏃 Health Tracking

Apple Health data auto-synced to InfluxDB via a local webhook:

- 6 Grafana dashboards (sleep, HRV, heart rate, VO2 Max, activity, SpO2)
    
- A **RandomForest ML model** retrained every Sunday at 3 AM
    
- 13 CLI commands: `summary`, `predict-sleep`, `anomalies`, `correlations`, `best-days`...
    

> ⚠️ Gotcha: Apple Health exports step counts as per-minute granules, not daily totals. My queries were returning "5 steps today" instead of thousands. Fixed by switching to `sum()` aggregation for cumulative metrics.

**Example prompts:**

> _"How did I sleep this week?"_
> 
> _"Predict tonight's sleep quality based on today's data"_
> 
> _"Any health anomalies I should know about?"_
> 
> _"What are my best performance days — what do they have in common?"_

---

### 🎙️ Voice 

Local **Coqui TTS** server (58 voices, 17 languages, completely free). Voice clips are generated as native Opus for Telegram or MP3 for the Nest Hub — zero ffmpeg pipeline.

**Morning briefing pipeline:**

Telegram message (GLM-5, full text ~800 words)
  +
Nest Hub vocal (MiniMax M2.7, condensed ~40 seconds, radio style)
  → Coqui TTS → MP3 → Cloudflare tunnel → pychromecast → Nest Hub

**Example prompts:**

> _"Read me the briefing on the Hub"_
> 
> _"Announce 'dinner is ready' on the Nest Hub"_
> 
> _"Tell me a bedtime story"_ (yes, with voice 🎭)

---

### 🧠 Memory System

Three-tier memory:

1. **Daily markdown logs** — raw session notes
    
2. **MEMORY.md** — curated long-term memory (only loaded in private sessions, never in group chats)
    
3. **ChromaDB vector DB** — 1,078 semantic chunks, multilingual-e5-small embeddings
    

**Example prompts:**

> _"What did we decide about the Roborock API last week?"_
> 
> _"Remind me of all the Hyper-V networking lessons we learned"_
> 
> _"Do you remember how we fixed the Grafana dashboard bug?"_

---

###  🔒 Security

- UFW active — SSH restricted to LAN only
    
- All secrets in `~/.openclaw/secrets/` (chmod 600), never hardcoded in config files
    
- **Cloudflare Access** on all public endpoints (email OTP)
    
- InfluxDB bound to localhost only
    
- Cloudflare tunnel for external HA access — zero exposed ports
    

---

###  📊 Monitoring Dashboard

Custom **Node.js dashboard** showing:

- 23 services across 8 categories (Core, AI, Data, Sync, Health, Finance, Media, Devices)
    
- Clickable sync jobs — click to trigger manually, shows last run + next scheduled
    
- Live Docker status, system RAM/disk/load
    

---

**Stack:** `OpenClaw` · `Home Assistant` · `Firefly III` · `Grafana` · `InfluxDB` · `ChromaDB` · `Coqui TTS` · `Immich` · `Cloudflare Tunnels` · `Roborock` · `Philips Hue` · `Docker` · `GLM-5` · `Kimi K2.5` · `Claude Sonnet` · `Python` · `Node.js`

Happy to answer questions — this thing has become part of my daily routine and I'm genuinely surprised how far you can push a fully self-hosted setup. AMA! 🤖
