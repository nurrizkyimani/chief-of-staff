---
title: RFC-001 - OpenClaw Telegram Receipt Assistant
date: 2026-04-05
status: Draft
owner: nurrizky
---

# RFC-001: OpenClaw Telegram Receipt Assistant (M1)

## 1) Goal
Build a personal assistant on OpenClaw where you can send receipt photos/PDFs in Telegram and get one normalized row per receipt in Google Sheets.

## 2) M1 Scope (Locked)
M1 only covers receipt-level extraction, not item-level analytics.

Required extracted fields per receipt:
- `merchant_name`
- `receipt_date`
- `total_amount`
- `tax_amount`
- `classification`

Additional operational fields:
- `receipt_id` (`<chat_id>:<message_id>`)
- `tax_label_raw`
- `currency` (default `IDR`)
- `confidence`
- `needs_review`
- `raw_json`
- `month_key` (`YYYY-MM`)

Out of scope for M1:
- line-item/category per item
- automatic budget alerts
- advanced tax reconciliation beyond printed values

### 2.1 User prerequisites (quick checklist)
Before implementation, you (the operator) need accounts, credentials, and a few manual steps. **Full step-by-step detail is in section 22.**

| What | Why |
| --- | --- |
| **OpenAI Platform account** + **API key** + **billing** | Vision + structured parsing via API (usage-based; separate from ChatGPT subscription). |
| **Google account** + **Google Cloud project** + **Sheets API** + **service account JSON** | Append rows to your spreadsheet via the Sheets API. |
| **Google Sheet** created by you, tabs `receipts_raw` + `monthly_breakdown`, **shared with the service account email** | API can only write if the SA has Editor access. |
| **Telegram bot** from **@BotFather** + **bot token** | Inbound receipt photos/PDFs. |
| **OpenClaw** installed/configured with Telegram channel + **pairing** | Gateway receives Telegram messages. |
| **(Recommended)** **Docker + Colima** on macOS | Matches M1 local sandbox strategy (section 18). |

## 3) Receipt Parsing Design

### 3.1 Architecture
```text
Telegram User
  -> OpenClaw Telegram Channel
  -> Receipt hook (message:preprocessed) filters /receipt + media
  -> OCR/Vision + LLM Structured Parser
  -> JSON Schema Validator
  -> Google Sheets Append (receipts_raw), idempotent by receipt_id
  -> Telegram confirmation response
```

**M1 integration mechanism (locked):** implement as an **OpenClaw internal hook** (see section 23), not a separate Telegram webhook server. The `SKILL.md` under `assistants/receipt-assistant/` documents behavior for the agent; the **executable** path is the hook handler calling the pipeline.

### 3.2 Parsing rules
- Parse from printed labels and values first.
- If multiple total-like labels exist, priority order:
  1. `Grand Total`
  2. `Total Bill`
  3. `Total Belanja`
  4. `TOTAL`
  5. `Bill`
- Tax labels recognized for amount extraction:
  - `PB1`, `PBJT`, `Pajak Resto`, `PPN`, `VAT`, `GST`, `Tax`, `Service Charge`, `Serv. Charge`
- Keep original tax text in `tax_label_raw`.
- Do not overwrite explicit printed tax values with guessed calculations.
- If key fields are uncertain/missing, set `needs_review=true` and keep payload in `raw_json`.

### 3.3 Trigger semantics (M1 locked)
- **Primary trigger:** user sends the **`/receipt`** command **in the same message as** a receipt **photo or document** (PDF/image), or replies to a prior message (implementation may support “reply to media” in a follow-up; if not supported in M1, document that limitation).
- **Do not** auto-parse every random photo in chat: that increases cost, false positives, and attack surface.
- **Albums:** if the user sends **multiple photos in one album**, M1 treats **each file as its own receipt** (one row per file, distinct `message_id` / Telegram file id in metadata as needed). If only one combined parse is desired, that is **out of scope for M1** (user sends one receipt per message or one file per message).
- **PDFs:** download file → convert to **one or more raster images** (first page minimum; cap pages, e.g. max 2–3 for M1) before vision. Document the chosen library or external tool in the implementation README.

### 3.4 OpenClaw wiring (summary; detail in section 23)
- Subscribe the hook to **`message:preprocessed`** so the body/media pipeline is complete (`context.bodyForAgent` / enriched content per OpenClaw hooks docs).
- Register the hook via **`hooks.internal.load.extraDirs`** pointing at `openclaw-platform/hooks/` (or enable **workspace hooks** under the agent workspace and list the hook explicitly—workspace hooks are **disabled by default** until config enables them).
- Filter inside the handler: channel is Telegram, text contains `/receipt`, attachment present.
- **Restart the gateway** after hook or config changes.

## 4) M1 JSON Contract (`receipt.v1.1`)

```json
{
  "schema_version": "receipt.v1.1",
  "receipt_id": "<chat_id>:<message_id>",
  "source": {
    "platform": "telegram",
    "chat_id": "<string>",
    "message_id": "<string>",
    "received_at": "2026-04-04T12:00:00Z"
  },
  "merchant_name": "<string>",
  "receipt_date": "YYYY-MM-DD",
  "total_amount": 0,
  "tax_amount": 0,
  "tax_label_raw": "PB1 10%|Service Charge",
  "classification": "food|mobility|groceries|nonfood|subscription",
  "currency": "IDR",
  "month_key": "YYYY-MM",
  "confidence": 0.0,
  "needs_review": false,
  "raw_json": {}
}
```

## 5) Classification Rules (M1)
Classification is receipt-level only (one class per receipt):
- `subscription`: recurring service signals or known subscription merchants (`spotify`, `netflix`, `youtube premium`, `chatgpt`, `icloud`, `canva`, `notion`, `midjourney`)
- `mobility`: transport/travel signals (`gojek`, `grab ride`, `bluebird`, `transjakarta`, `mrt`, `krl`, `toll`, `parkir`, `pertamina`, `shell`)
- `groceries`: merchant contains `alfamart`, `indomaret`, `minimarket`, `supermarket`, `hypermart`
- `food`: restaurant/cafe/delivery-food context (`restaurant`, `rumah makan`, `kopi`, `coffee`, `cafe`, `gofood`, `grabfood`, `shopeefood`, `delivery order`)
- `nonfood`: fallback for retail/non-consumable spending not matched above

Rule precedence is exactly the order above.

## 6) Google Sheets Design (Same Spreadsheet File)

**Manual setup:** create an empty spreadsheet (or use an existing one). Add tabs named exactly `receipts_raw` and `monthly_breakdown`. In row 1 of `receipts_raw`, add the column headers below (implementation may create headers programmatically once, but M1 assumes the tab exists). **Share the spreadsheet with the service account client email** (from the JSON: `client_email`) with **Editor** access, or writes will fail.

### 6.1 Sheet A: `receipts_raw` (append-only)
Columns (aligned with `receipt.v1.1`; `monthly_breakdown` still uses A–G only):

| Col | Header | Notes |
| --- | --- | --- |
| A | `receipt_id` | Unique key for idempotency |
| B | `message_id` | Telegram message id |
| C | `merchant_name` | |
| D | `receipt_date` | `YYYY-MM-DD` |
| E | `total_amount` | Numeric |
| F | `tax_amount` | Numeric |
| G | `classification` | |
| H | `currency` | Default `IDR` |
| I | `confidence` | 0–1 |
| J | `needs_review` | `TRUE`/`FALSE` or `yes`/`no` (pick one convention and stick to it) |
| K | `tax_label_raw` | Free text |
| L | `month_key` | `YYYY-MM` (redundant with D but useful for filters) |
| M | `raw_json` | **Stringified JSON** of `raw_json` (truncate if near cell size limits; full payload must still appear in logs—section 25) |

Write method:
- `spreadsheets.values.append`
- `valueInputOption=USER_ENTERED`
- Append range: `receipts_raw!A:M` (header row excluded from append range if row 1 is headers)

Idempotency (M1 algorithm):
1. Before append, call **`spreadsheets.values.get`** on `receipts_raw!A:A` (or batch read with a reasonable row window if the sheet is huge) and check whether `receipt_id` already exists.
2. If duplicate → **skip append** and return a Telegram message: “Already recorded (`receipt_id`).”
3. **Race window:** two parallel requests could still double-append in theory; M1 accepts this low risk, or a later milestone adds a stronger lock (e.g. external store). Document in ops if duplicates appear.

### 6.1.1 Google Cloud / Sheets API prerequisites
- Create a **Google Cloud project** (free tier is fine for personal use; billing may be required depending on GCP policy).
- **Enable** the **Google Sheets API** for that project.
- Create a **service account**, grant a minimal role for Sheets (custom role with only what you need, or Editor on the single sheet via sharing—not project-wide Owner unless you accept that).
- Create and download a **JSON key**; path → `GOOGLE_APPLICATION_CREDENTIALS`.

### 6.2 Sheet B: `monthly_breakdown`
Monthly totals by classification, from `receipts_raw`.

Recommended formula in `monthly_breakdown!A1`:
```gs
=QUERY({ARRAYFORMULA(IF(receipts_raw!D2:D<>"",TEXT(receipts_raw!D2:D,"yyyy-mm"),)),receipts_raw!G2:G,receipts_raw!E2:E,receipts_raw!F2:F,receipts_raw!A2:A},"select Col1, Col2, sum(Col3), sum(Col4), count(Col5) where Col1 is not null group by Col1, Col2 label Col1 'month', Col2 'classification', sum(Col3) 'total_amount', sum(Col4) 'total_tax', count(Col5) 'receipt_count'",0)
```

## 7) Milestone Definition
M1 is complete when:
- each Telegram receipt creates one reliable row in `receipts_raw`
- all 5 required fields are extracted (`merchant_name`, `receipt_date`, `total_amount`, `tax_amount`, `classification`)
- `monthly_breakdown` updates correctly by `month + classification`
- low-confidence cases are marked with `needs_review=true`

## 8) Model Connection (How it works)
- OpenClaw is the orchestration layer; model inference needs a provider connection.
- For M1, provider choice is OpenAI API.
- For M1, model choice is locked to one model only: `OpenAI GPT-4.1 mini` (configured in OpenClaw as the primary model).
- You need:
  - OpenAI API account
  - API key
  - key configured in OpenClaw environment (example: `OPENAI_API_KEY`)
  - a **vision-capable** model path for receipt images (confirm in current OpenAI docs that **`gpt-4.1-mini`** supports image inputs for your chosen API; if not, adjust M1 model in config **before** locking production—this RFC assumes vision works for the locked model).
- ChatGPT subscription is not required for API usage; API billing is separate usage-based billing.

## 9) Repository + Install Strategy (Locked)
We will keep platform and docs in the same repository (`chief-of-staff`) as requested.

Repository structure decision:
- `obsidian-vault/` for planning/docs/RFCs
- `openclaw-platform/` for OpenClaw runtime/config/integration code

Install strategy decision:
- Prefer **project-local** OpenClaw: add it as a **dependency** in `openclaw-platform/package.json` (exact version pinned) and invoke via **`npx openclaw ...`** from `openclaw-platform/`, **or** use whatever install path the official docs recommend for reproducible CLI **without** relying on a mutable global `openclaw` on `$PATH`.
- The **`curl | bash`** installer (section 20) is acceptable **only** if you verify where the binary lands and you still set **`OPENCLAW_HOME`** under `openclaw-platform/` so state is project-local; otherwise prefer `npm`/`pnpm` install into the repo.

Where receipt assistant code goes:
- Receipt assistant behavior, prompts, skill/hook logic: under `openclaw-platform/`
- Google Sheets integration code: under `openclaw-platform/`
- Secrets/env keys: project-local env setup under `openclaw-platform/` and gitignored

## 10) M1 Delivery Shape (Config vs Code)
What is configuration-only in M1:
- OpenClaw provider/auth setup (OpenAI key)
- Telegram channel binding
- Model default selection (`GPT-4.1 mini`)
- Tool/plugin enablement

What requires custom project code in M1:
- Receipt parser orchestration (image -> structured JSON)
- Validation + confidence flagging
- Google Sheets append writer (`receipts_raw`)
- Idempotency check using `receipt_id`

Note:
- We do not modify OpenClaw core framework code for M1.

## 11) Test Targets for M1
Dataset:
- at least 60 mixed receipts (including PB1, PPN, service charge, blurry images, rotated photos)

Minimum accuracy:
- `merchant_name` >= 90%
- `receipt_date` >= 90%
- `total_amount` >= 95%
- `tax_amount` >= 85%
- `classification` >= 85%

## 12) Conversation Decision Log (Append-only Snapshot, 2026-04-04)
- M1 scope fixed to receipt-level extraction only, not item-level parsing.
- Required M1 outputs fixed: merchant, date, total, tax, classification.
- Monthly aggregation will be in a second tab (`monthly_breakdown`) within the same Google Sheet file.
- Primary deployment preference: keep everything in `chief-of-staff` with a dedicated runtime subfolder.
- OpenClaw repo/runtime will not be installed globally.
- First model for M1 is fixed to one model: OpenAI GPT-4.1 mini.
- Alternative cheaper providers were discussed for later milestones, but not selected for M1.
- Classification taxonomy updated to: `food|mobility|groceries|nonfood|subscription`.
- Sandbox direction fixed to local `Docker + Colima` with parity-first rollout.
- Parity requirement fixed: normal commands and intended receipt behavior must remain unchanged between non-sandbox and sandbox mode.
- 2026-04-05: RFC expanded with user account checklist, OpenClaw hook-based integration (`message:preprocessed`), locked `/receipt` trigger, `receipts_raw` columns A–M, idempotency algorithm, PDF/album notes, sandbox egress allowlist, failure-mode UX, observability, and executability notes.

## 13) References
- OpenClaw Getting Started: https://docs.openclaw.ai/start/getting-started
- OpenClaw Telegram channel docs: https://docs.openclaw.ai/channels/telegram
- OpenClaw Tools: https://docs.openclaw.ai/tools
- OpenClaw Hooks: https://docs.openclaw.ai/automation/hooks
- Telegram Bot API: https://core.telegram.org/bots/api
- Google Sheets `spreadsheets.values.append`: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
- Google Sheets API overview (enable API, quotas): https://developers.google.com/workspace/sheets/api/guides/concepts
- OpenClaw docs index (`llms.txt`): https://docs.openclaw.ai/llms.txt
- UU No. 1 Tahun 2022 (HKPD): https://peraturan.go.id/files/uu1-2022bt.pdf
- OpenAI API Pricing: https://openai.com/api/pricing/

## 14) Example Project Structure (Visualization)
The following is the recommended monorepo layout inside `chief-of-staff`.

```text
chief-of-staff/
|-- obsidian-vault/
|   |-- JOURNAL-DRAFT.md
|   `-- rfc-vault/
|       `-- RFC-001-openclaw-telegram-receipt-assistant.md
|
|-- openclaw-platform/
|   |-- README.md
|   |-- .env.example
|   |
|   |-- config/
|   |   |-- openclaw.config.json
|   |   `-- providers.json
|   |
|   |-- hooks/
|   |   `-- receipt-intake/
|   |       |-- HOOK.md
|   |       `-- handler.ts
|   |
|   |-- assistants/
|   |   `-- receipt-assistant/
|   |       |-- SKILL.md
|   |       |-- prompts/
|   |       |   `-- receipt_parser.prompt.md
|   |       |-- schemas/
|   |       |   `-- receipt.v1.1.schema.json
|   |       |-- parsers/
|   |       |   `-- parse_receipt.ts
|   |       |-- classifiers/
|   |       |   `-- classify_receipt.ts
|   |       `-- tests/
|   |           `-- receipt_fixtures/
|   |
|   |-- integrations/
|   |   `-- google-sheets/
|   |       |-- sheets_client.ts
|   |       |-- append_receipt_row.ts
|   |       `-- ensure_monthly_formula.ts
|   |
|   |-- pipelines/
|   |   `-- receipt_pipeline.ts
|   |
|   `-- scripts/
|       |-- backfill_receipts.ts
|       `-- validate_receipt_schema.ts
|
`-- .gitignore
```

## 15) Function Responsibilities (M1)
Core entrypoint:
- Hook **`handler.ts` default export**: on `message:preprocessed`, if Telegram + `/receipt` + media → call `runReceiptPipeline(event)` (name as you prefer). Avoid throwing; catch errors and push user-visible messages (section 24).
- `runReceiptPipeline(event)`: maps OpenClaw event context to `receipt_id`, downloads media via Telegram file APIs as needed, then runs parsing → validate → sheets.

Parsing and normalization:
- `extractReceiptFromImage(input)`: image/PDF -> structured candidate fields.
- `normalizeReceiptDate(rawDate)`: normalize mixed date formats to `YYYY-MM-DD`.
- `selectTotalAmount(lines)`: choose final total by priority (`Grand Total` -> `Total Bill` -> `Total Belanja` -> `TOTAL` -> `Bill`).
- `extractTaxAmountAndLabel(lines)`: parse tax amount and keep raw label text.
- `buildMonthKey(receiptDate)`: derive `YYYY-MM`.

Classification:
- `classifyReceipt(merchantName, rawText)`: output one of `food|mobility|groceries|nonfood|subscription`.

Validation and persistence:
- `validateReceiptV11(payload)`: schema validation for `receipt.v1.1`.
- `toReceiptsRawRow(payload)`: map payload to Google Sheets row columns.
- `appendReceiptsRawRow(row)`: append into `receipts_raw` tab.
- `ensureMonthlyBreakdownFormula()`: ensure formula exists in `monthly_breakdown!A1`.
- `isDuplicateReceipt(receiptId)`: idempotency check to avoid duplicate rows.

Response:
- `buildTelegramConfirmation(payload, appendResult)`: return concise parse result + status to user.

## 16) JSON Structures (Examples)

### 16.1 Parsed Receipt Payload (`receipt.v1.1`)
```json
{
  "schema_version": "receipt.v1.1",
  "receipt_id": "123456789:98765",
  "source": {
    "platform": "telegram",
    "chat_id": "123456789",
    "message_id": "98765",
    "received_at": "2026-04-04T12:30:00Z"
  },
  "merchant_name": "ALFAMART ALIPATAN",
  "receipt_date": "2023-07-23",
  "total_amount": 25400,
  "tax_amount": 2547,
  "tax_label_raw": "PPN",
  "classification": "groceries",
  "currency": "IDR",
  "month_key": "2023-07",
  "confidence": 0.93,
  "needs_review": false,
  "raw_json": {
    "detected_total_label": "Total Belanja",
    "detected_tax_label": "PPN",
    "ocr_excerpt": "Total Belanja 25,400 ... PPN (2,547) ... Tgl 23-07-2023"
  }
}
```

### 16.2 Google Sheets Append Request Shape (`receipts_raw`)
Column mapping for `receipts_raw!A:M`:
- `A`–`I`: as before (`receipt_id` … `confidence`)
- `J`: `needs_review`
- `K`: `tax_label_raw`
- `L`: `month_key`
- `M`: `raw_json` (stringified object; optional truncation with full copy in logs)

```json
{
  "range": "receipts_raw!A:M",
  "majorDimension": "ROWS",
  "values": [
    [
      "123456789:98765",
      "98765",
      "ALFAMART ALIPATAN",
      "2023-07-23",
      25400,
      2547,
      "groceries",
      "IDR",
      0.93,
      false,
      "PPN",
      "2023-07",
      "{\"detected_total_label\":\"Total Belanja\"}"
    ]
  ]
}
```

### 16.3 Monthly Breakdown Output Shape (from formula)
```json
{
  "month": "2023-07",
  "classification": "groceries",
  "total_amount": 25400,
  "total_tax": 2547,
  "receipt_count": 1
}
```

## 17) Stack Recommendation (TypeScript vs Python)
Recommended for this project: **TypeScript**.

Why TypeScript is the better default here:
- Strong fit with the current RFC structure and file layout under `openclaw-platform/` (`.ts` pipeline/integration modules).
- Smooth JSON-schema-first workflow (shared types + runtime validation).
- Easy Google Sheets integration with mature Node ecosystem and async flow for webhook-style pipelines.
- Consistent typing from parser output -> validator -> sheet row mapping reduces production mistakes.

When Python is still a good choice:
- If your team is already much faster in Python.
- If you plan heavy data science/ML preprocessing beyond model API extraction.

M1 decision:
- Use **TypeScript** for implementation.

## 18) Local Sandbox Strategy (Parity-First)
Goal:
- keep development local
- reduce risk from unwanted tool behavior
- keep normal assistant behavior and commands unchanged

Selected strategy for M1:
- `Docker + Colima` on local machine
- sandbox mode rollout: `parity-first`
- network policy target: `default deny + allowlist` after parity baseline is confirmed

What parity-first means:
- same start/run commands as non-sandbox workflow
- same model (`gpt-4.1-mini`) and same environment values
- same pipeline outputs for intended receipt flows
- sandbox only blocks unsafe or explicitly disallowed actions

Open-source runtime/sandbox options considered:
- `Docker + Colima` (selected)
- `Podman machine`
- `Lima + containerd/nerdctl`
- `gVisor` (`runsc`) for stronger isolation (future hardening)
- `Kata Containers` for VM-backed container isolation (future hardening)

M1 hardening baseline:
- no global OpenClaw install
- project-local runtime only
- least-privilege container settings
- limited mount points
- only required outbound domains allowed after parity validation

**M1 sandbox egress allowlist (initial):** after parity baseline, restrict outbound to at least:
- `api.openai.com` (OpenAI API)
- `sheets.googleapis.com` (Google Sheets API)
- `oauth2.googleapis.com` and `www.googleapis.com` if the client library requires token endpoints
- Any host your OpenClaw/Telegram stack uses for **Telegram Bot API** if tools or the gateway call it over HTTPS (confirm from your runtime’s actual requests)

Tune the list using network logs from a successful dry run; **default deny** without this list will break the pipeline.

## 19) Behavior Parity Acceptance Checklist (Sandbox vs Non-Sandbox)
The sandbox setup is accepted only if all checks pass:
- same command entrypoint for standard run flow
- same receipt extraction fields and JSON contract output
- same Google Sheets write behavior for valid receipts
- same classification output for the golden test set
- no regression in M1 accuracy targets

Known expected difference:
- malicious/unwanted actions can be blocked in sandbox mode; this is intentional and not treated as parity failure.

## 20) End-to-End Run Guide (Local + Sandbox, Parity-First)
This runbook follows the selected M1 approach: local execution with project-local OpenClaw and sandbox parity-first.

1. Create runtime workspace in this repository:
```bash
mkdir -p openclaw-platform
cd openclaw-platform
```

2. Install local runtime prerequisites (macOS):
```bash
brew install colima docker node
colima start
docker ps
```

3. Install OpenClaw in a **project-local** way and verify (pick one path and document it in `openclaw-platform/README.md`):
```bash
# Example: from openclaw-platform/ after package.json includes openclaw
npm install
npx openclaw --version
# Alternative per official docs: curl installer — then still pin OPENCLAW_HOME below
```

4. Keep OpenClaw state project-local:
```bash
export OPENCLAW_HOME="$PWD/.openclaw-home"
mkdir -p "$OPENCLAW_HOME"
```

5. Add environment variables (see section 21), then load them:
```bash
set -a
source .env
set +a
```

6. Run onboarding and bring up gateway:
```bash
openclaw onboard
openclaw gateway
```

7. Configure Telegram channel and pairing flow:
```bash
openclaw pairing list telegram
openclaw pairing approve telegram <PAIR_CODE>
```

7b. **Lock down who can talk to the bot** using OpenClaw Telegram config (e.g. `channels.telegram.allowFrom` with **your numeric user id** or `@username`). See OpenClaw Telegram docs. Do not leave a personal finance bot open to the world.

8. Enable sandbox with parity-first behavior:
```bash
openclaw config set agents.defaults.sandbox.mode "all"
openclaw config set agents.defaults.sandbox.scope "session"
openclaw config set agents.defaults.sandbox.workspaceAccess "rw"
```

9. Run health/security checks:
```bash
openclaw doctor
openclaw security audit
```

10. Execute end-to-end validation:
- send a receipt photo to Telegram bot
- verify assistant response fields (`merchant_name`, `receipt_date`, `total_amount`, `tax_amount`, `classification`)
- verify append in `receipts_raw`
- verify monthly rollup in `monthly_breakdown`

11. Parity verification (non-sandbox vs sandbox):
- run the same golden receipt set in both modes
- compare extracted values and classification outputs
- accept only if section 19 checklist passes

## 21) Required Environment Variables (M1)
Create `openclaw-platform/.env` with:

```bash
# Model provider
OPENAI_API_KEY=your_openai_api_key

# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Google Sheets
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
RECEIPT_SPREADSHEET_ID=your_google_sheet_id
RECEIPT_SHEET_RAW=receipts_raw
RECEIPT_SHEET_MONTHLY=monthly_breakdown

# Runtime defaults
RECEIPT_MODEL=openai/gpt-4.1-mini
NODE_ENV=development
TZ=Asia/Jakarta
```

Optional but recommended:
```bash
# Keep OpenClaw state local to this project
OPENCLAW_HOME=/absolute/path/to/chief-of-staff/openclaw-platform/.openclaw-home
```

Notes:
- API billing for OpenAI is usage-based and separate from ChatGPT subscription.
- Keep `.env` and service-account JSON out of git.

## 22) User prerequisites: accounts, billing, and manual steps (detailed)

Follow in order; you can skip steps you already have.

### A) OpenAI (API for GPT-4.1 mini + vision)
1. Create an account at [OpenAI Platform](https://platform.openai.com/).
2. Add a **payment method** and ensure **API access** is enabled (usage-based billing).
3. Create an **API key** (Dashboard → API keys). Store it only in `.env` / secret store, not in git.
4. Before locking M1, run one **test vision request** (image + prompt) against **`gpt-4.1-mini`** (or the exact model id you configure) to confirm **image input** works for your integration path.

### B) Google Cloud + Google Sheets API (spreadsheet writes)
1. Sign in to [Google Cloud Console](https://console.cloud.google.com/) with a Google account.
2. **Create a project** (name it e.g. `receipt-assistant`). Note the **project id**.
3. **Enable** the **Google Sheets API** for that project (APIs & Services → Library → “Google Sheets API” → Enable).
4. **Create a service account** (IAM & Admin → Service Accounts → Create). Give it a clear name (e.g. `receipt-sheets-writer`).
5. **Create a JSON key** for that service account (Keys → Add key → JSON). Download and store outside git; set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path.
6. Open the JSON and copy **`client_email`** (ends with `@...gserviceaccount.com`).
7. In **Google Sheets**, create a spreadsheet (or pick an existing one). **Share** it with **`client_email`** with **Editor** access. Without this, API calls return permission errors.
8. Copy the spreadsheet id from the URL (`/d/<SPREADSHEET_ID>/`) into `RECEIPT_SPREADSHEET_ID`.

**Billing:** GCP may ask for a billing account depending on product policy; for Sheets API usage from a service account, costs are typically low for personal volume—still monitor quotas in Cloud Console.

### C) Telegram bot
1. In Telegram, open a chat with **@BotFather**.
2. Run `/newbot`, follow prompts, and obtain the **HTTP API token**.
3. Store the token in `TELEGRAM_BOT_TOKEN` (or whatever OpenClaw’s config expects—follow OpenClaw Telegram docs).
4. Complete **OpenClaw pairing** for your Telegram channel (section 20, step 7).
5. **Restrict who can use the bot** using `channels.telegram.allowFrom` (your numeric user id or `@username`) per OpenClaw Telegram documentation—treat this as mandatory for a personal finance bot.

### D) Local machine (macOS, recommended path in this RFC)
1. Install **Homebrew** if missing.
2. Install **Node.js** (LTS), **Docker**, and **Colima** (section 20).
3. Start Colima and verify `docker ps` works.

### E) Optional: Telegram user id (for allowlists)
- DM your bot, then use `openclaw logs --follow` and read `from.id`, **or** call `getUpdates` per Telegram Bot API docs, **or** use an id bot—prefer the official logs method for privacy (see OpenClaw FAQ / Telegram docs).

## 23) OpenClaw integration (M1): hooks, discovery, and security

### Hook shape (per OpenClaw)
- One directory per hook: `HOOK.md` (frontmatter with `metadata.openclaw.events`) + `handler.ts` (default export async function).
- **Recommended event:** `message:preprocessed` so media and text enrichment are ready.
- **Events array** should list only what you need (e.g. `["message:preprocessed"]`) to limit overhead.

### Where hooks are loaded from
Discovery order (simplified): bundled → plugin → managed `~/.openclaw/hooks/` → workspace. For this repo, prefer:
- **`hooks.internal.load.extraDirs`** in config pointing to `openclaw-platform/hooks/`, **or**
- **Workspace hooks** under the agent workspace `/hooks/`, explicitly **enabled** in config (disabled by default).

### Config tasks
1. Point extra hook directory at `openclaw-platform/hooks/receipt-intake/` (parent of `HOOK.md`).
2. **Enable** the hook entry if your OpenClaw version requires per-hook `enabled: true`.
3. **Restart the gateway** after changes (`openclaw gateway` process).

### Telegram hardening
- Set **`channels.telegram.allowFrom`** to **your** Telegram user id (numeric recommended) or `@username` so random users cannot use the bot or exfiltrate data via prompts.
- Keep pairing approval workflow documented for new devices.

### Relationship to `SKILL.md`
- **`assistants/receipt-assistant/SKILL.md`**: documents instructions for the **agent** (prompts, tools, behavior).
- **`hooks/receipt-intake/handler.ts`**: **deterministic** pipeline for `/receipt` + media → Sheets. Both can coexist; M1 **requires** the hook path for the locked automation behavior.

## 24) Failure modes and user-facing responses

| Situation | User sees (Telegram) | Internal behavior |
| --- | --- | --- |
| Missing `/receipt` or missing media | Short usage hint: “Send `/receipt` with a photo or PDF.” | Return early from hook |
| Duplicate `receipt_id` | “Already saved (receipt …).” | Skip append (section 6) |
| Schema / validation failure | “Couldn’t parse reliably; needs review.” Include `needs_review` if partial payload exists | Log full `raw_json`; do not claim success |
| OpenAI API error (rate limit, 5xx) | “Temporary error; retry in a minute.” | Retry with backoff where safe; log request id if present |
| Sheets API error (403, 404, quota) | “Could not save to sheet; check bot config.” | Log HTTP status; do not mark as saved |
| PDF too many pages | “Only first N pages used” (if implemented) or error | Enforce cap in code |
| File too large for Telegram | Telegram error surfaced | Respect Bot API limits; suggest smaller image |

Hooks should **not throw** uncaught exceptions; use `try/catch`, log, and **push** a user message via `event.messages` (see OpenClaw hooks docs) so other handlers still run.

## 25) Observability and logging

- **Gateway / OpenClaw logs:** follow OpenClaw docs for log locations (e.g. `/tmp/openclaw/` default daily log); use **`openclaw status`**, **`openclaw logs --follow`**, and **`openclaw health`** when debugging channels.
- **Application logging:** log one line per receipt with `receipt_id`, outcome (`appended` / `duplicate` / `error`), and **non-sensitive** merchant/date summary—never log API keys or full Telegram tokens.
- **`raw_json`:** full structured debug payload should appear in **logs** if the sheet cell is truncated.
- **Sheets:** optional “errors” or “audit” tab is **out of scope for M1** unless needed for ops.

## 26) Is M1 easily executable?

**Mostly yes** for someone comfortable with **Node/TypeScript**, **environment variables**, **Google Cloud service accounts**, and **running a long-lived local gateway**. The pipeline itself is standard: vision LLM → JSON validate → Sheets append.

**Where time usually goes:**
- **OpenClaw hook wiring** (correct event, discovery path, gateway restart, `allowFrom`).
- **Sandbox egress** if you enable default-deny network rules before validating hosts.
- **Telegram edge cases** (albums, PDF rendering, large files).
- **Verifying** the locked model accepts **images** on your exact API path.

**Not “one click”:** expect **0.5–2 days** for an experienced developer to get end-to-end first success, plus time for the **60-receipt** evaluation set. Newcomers to GCP or OpenClaw should add buffer.

---

*RFC-001 end.*
