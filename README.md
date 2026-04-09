# chief-of-staff

Planning and execution workspace for personal assistant projects, starting with the OpenClaw Telegram receipt assistant.

## Purpose
This repository is used to:
- capture product and technical decisions in RFC format
- keep implementation planning close to day-to-day notes
- prepare a monorepo structure for upcoming OpenClaw-based assistants

## Current Status
- Active focus: `RFC-001` (Telegram receipt parser -> structured JSON -> Google Sheets)
- Milestone M1 is actively implemented in `openclaw-platform/`
- OpenClaw local runtime wrapper + Make workflow are in place
- Receipt hook pipeline, schema validation, and Google Sheets append flow are implemented

## Repository Structure
```text
chief-of-staff/
|-- obsidian-vault/
|   |-- JOURNAL-DRAFT.md
|   `-- rfc-vault/
|       `-- RFC-001-openclaw-telegram-receipt-assistant.md
|-- openclaw-platform/
|   |-- README.md
|   |-- Makefile
|   |-- hooks/
|   |-- src/
|   `-- config/
|-- .obsidian/
`-- README.md
```

## Key Document
- `obsidian-vault/rfc-vault/RFC-001-openclaw-telegram-receipt-assistant.md`
  - includes scope, architecture, schema, project visualization, function responsibilities, and Google Sheets mapping

## Planned Stack (M1)
- Orchestration: OpenClaw
- Model: OpenAI `gpt-4.1-mini`
- Language: TypeScript
- Channel: Telegram
- Output sink: Google Sheets (`receipts_raw` + `monthly_breakdown`)

## Notes
- This repo intentionally keeps planning and implementation decisions in one place.
- OpenClaw should be installed project-locally (not globally).
