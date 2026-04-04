

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