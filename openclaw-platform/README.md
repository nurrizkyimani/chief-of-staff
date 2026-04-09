# openclaw-platform (M1 executable, OpenClaw-first)

Local implementation for RFC-001:
- Telegram receipt intake (`/receipt` + image-first flow)
- Mistral extraction (`mistral-small-2506`)
- `receipt.v1.1` validation
- Google Sheets append to `receipts_raw` + `monthly_breakdown` formula bootstrap

## Local-first OpenClaw

This project is set up to prefer a project-local OpenClaw binary.

- Primary launcher: `scripts/openclaw-local.sh`
- Make targets call that launcher
- `OPENCLAW_HOME` defaults to `openclaw-platform/.openclaw-home`
- Global OpenClaw is only used if `OPENCLAW_ALLOW_GLOBAL=1` is set

`openclaw` is pinned in this repo (`openclaw@2026.4.8`) and installed via `npm install`.

## Step-by-step (Local Telegram end-to-end)

## 1) Install host runtime (one-time, macOS)

```bash
cd openclaw-platform
make install-host
make colima-up
make docker-check
```

## 2) Install app deps and env

```bash
cd openclaw-platform
make install
cp .env.example .env
```

Fill `.env` values:
- `MISTRAL_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `RECEIPT_SPREADSHEET_ID`
- `RECEIPT_SHEET_RAW`
- `RECEIPT_SHEET_MONTHLY`
- `RECEIPT_MAX_PDF_PAGES` (default `3`)
- `RECEIPT_ACCEPT_PDF` (`false` = image-first mode, keep PDF code path but disable intake)
- `RECEIPT_STRICT_MEMORY_ONLY` (`true` = image-only strict in-memory mode)

## 3) Prepare Google Sheet

Create tabs:
- `receipts_raw`
- `monthly_breakdown`

In `receipts_raw` row 1, add A:M headers:
`receipt_id,message_id,merchant_name,receipt_date,total_amount,tax_amount,classification,currency,confidence,needs_review,tax_label_raw,month_key,raw_json`

Share the sheet with the service-account `client_email` as Editor.

## 4) Ensure OpenClaw CLI is available locally

```bash
make openclaw-version
```

The default path uses `./node_modules/.bin/openclaw` from this project.

## 5) Configure OpenClaw (hooks + Telegram + sandbox defaults)

Use [config/openclaw.config.json](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/config/openclaw.config.json) as baseline.

Important updates before use:
- replace `channels.telegram.allowFrom` placeholder with your numeric Telegram user id
- set absolute path for `hooks.internal.load.extraDirs`

Core fields included in the config:
- internal hook discovery + `receipt-intake` enablement
- Telegram `dmPolicy=allowlist`
- sandbox defaults (`mode=all`, `scope=session`, `workspaceAccess=rw`)
- sandbox Docker network default `none` (default deny egress)

Then apply and validate:

```bash
make config-validate
make gateway-mode-local
make doctor
make doctor-fix
```

## 6) Configure Telegram in OpenClaw

Set token (`TELEGRAM_BOT_TOKEN`) and pair:

```bash
make telegram-user-id
make pairing-list-telegram
make pairing-approve-telegram PAIR_CODE=<from-list-command>
```

Then set `channels.telegram.allowFrom` to `telegram:<your_numeric_user_id>`.

## 7) Start gateway

```bash
make gateway
```

In another terminal, follow logs:

```bash
make logs
```

## 8) Test from Telegram

Send `/receipt` plus a photo/image to your bot.

Expected result:
- Telegram first sends parsed fields with `Confirm` / `Cancel` buttons
- Row is appended to `receipts_raw` only after `Confirm`
- `monthly_breakdown!A1` formula auto-created if empty

PDF behavior:
- PDF is rasterized via `pdftoppm` (poppler-utils)
- only first `RECEIPT_MAX_PDF_PAGES` pages are processed
- bot includes a note when a PDF is truncated
- image-first mode keeps PDF support in code, but intake is disabled by default unless `RECEIPT_ACCEPT_PDF=true`

Model connectivity check from Telegram:
- send `/modelhealth`
- bot replies with provider, configured model, served model, latency, and success/failure

Album behavior:
- multiple media attachments in one message are processed independently
- each media/page gets a deterministic derived `message_id` suffix for idempotency

## Media privacy (avoid saving pictures)

- For photos/images, this pipeline fetches media into memory and sends it to the model directly.
- No image files are written into the project workspace.
- If you want strict image-only behavior (no PDF temp conversion path), set:

```bash
RECEIPT_STRICT_MEMORY_ONLY=true
```

- With `RECEIPT_STRICT_MEMORY_ONLY=true`, PDFs are rejected and only image/photo input is accepted.

## Docker + Colima (RFC parity path)

## 1) Start Colima + Docker

```bash
make colima-up
make docker-check
```

## 2) Build and run gateway container

```bash
make docker-build
make docker-up
make docker-logs
```

Files:
- [Dockerfile](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/Dockerfile)
- [docker-compose.yml](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/docker-compose.yml)

## Sandbox mode + egress controls

Sandbox mode helpers:

```bash
make sandbox-enable
make sandbox-disable
make sandbox-explain
make sandbox-recreate
```

Sandbox Docker network helpers:

```bash
make sandbox-network-none
make sandbox-network-bridge
make sandbox-network-custom SANDBOX_DOCKER_NETWORK=<network-name>
```

Egress baseline allowlist domains are tracked in:
- [config/sandbox-egress-allowlist.txt](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/config/sandbox-egress-allowlist.txt)

Print current list:

```bash
make sandbox-egress-allowlist
```

## Parity checklist tooling

Compare baseline vs sandbox extracted outputs (JSON files you generate from your runs):

```bash
make parity-compare BASELINE=./baseline.json SANDBOX=./sandbox.json
```

Script:
- [compare_parity_results.ts](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/src/scripts/compare_parity_results.ts)

## Backfill tooling

Run historical receipts into the same pipeline:

```bash
make backfill INPUT=./backfill.json
```

Script:
- [backfill_receipts.ts](/Users/nurrizky/dev/chief-of-staff/openclaw-platform/src/scripts/backfill_receipts.ts)

## Utility targets

```bash
make help
make validate-schema
make status
make health
make doctor
make doctor-fix
make gateway-mode-local
make security-audit
make onboard
```
