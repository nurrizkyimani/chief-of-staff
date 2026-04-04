---
title: RFC-001 - OpenClaw Telegram Receipt Assistant
date: 2026-04-04
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

## 3) Receipt Parsing Design

### 3.1 Architecture
```text
Telegram User
  -> OpenClaw Telegram Channel
  -> Receipt Intake Skill (MVP: /receipt command)
  -> OCR/Vision + LLM Structured Parser
  -> JSON Schema Validator
  -> Google Sheets Append (receipts_raw)
  -> Telegram confirmation response
```

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

### 6.1 Sheet A: `receipts_raw` (append-only)
Columns:
1. `receipt_id`
2. `message_id`
3. `merchant_name`
4. `receipt_date`
5. `total_amount`
6. `tax_amount`
7. `classification`
8. `currency`
9. `confidence`

Write method:
- `spreadsheets.values.append`
- `valueInputOption=USER_ENTERED`

Idempotency:
- Do not append duplicates for same `receipt_id`.

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
  - a vision-capable model configured in OpenClaw
- ChatGPT subscription is not required for API usage; API billing is separate usage-based billing.

## 9) Repository + Install Strategy (Locked)
We will keep platform and docs in the same repository (`chief-of-staff`) as requested.

Repository structure decision:
- `obsidian-vault/` for planning/docs/RFCs
- `openclaw-platform/` for OpenClaw runtime/config/integration code

Install strategy decision:
- Do not install OpenClaw globally.
- Install OpenClaw project-locally inside `openclaw-platform/` for reproducibility and easier upgrades.

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

## 13) References
- OpenClaw Getting Started: https://docs.openclaw.ai/start/getting-started
- OpenClaw Telegram channel docs: https://docs.openclaw.ai/channels/telegram
- OpenClaw Tools: https://docs.openclaw.ai/tools
- OpenClaw Hooks: https://docs.openclaw.ai/automation/hooks
- Telegram Bot API: https://core.telegram.org/bots/api
- Google Sheets `spreadsheets.values.append`: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
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
|   |-- channels/
|   |   `-- telegram/
|   |       `-- webhook_handler.ts
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
|   |-- hooks/
|   |   `-- on_receipt_message.ts
|   |
|   `-- scripts/
|       |-- backfill_receipts.ts
|       `-- validate_receipt_schema.ts
|
`-- .gitignore
```

## 15) Function Responsibilities (M1)
Core entrypoint:
- `onReceiptMessage(event)`: receives Telegram receipt message and starts M1 pipeline.

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
Column mapping for `receipts_raw!A:I`:
- `A`: `receipt_id`
- `B`: `message_id`
- `C`: `merchant_name`
- `D`: `receipt_date`
- `E`: `total_amount`
- `F`: `tax_amount`
- `G`: `classification`
- `H`: `currency`
- `I`: `confidence`

```json
{
  "range": "receipts_raw!A:I",
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
      0.93
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
