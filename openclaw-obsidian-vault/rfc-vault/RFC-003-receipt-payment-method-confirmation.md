---
title: RFC-003 - Receipt Payment Method Confirmation
date: 2026-07-01
status: Draft
owner: nurrizky
depends_on:
  - RFC-001-openclaw-telegram-receipt-assistant.md
---

# RFC-003: Receipt Payment Method Confirmation

## 1) Goal
Extend the existing Telegram finance receipt bot so every confirmed receipt can record a normalized `payment_method` in `receipts_raw`.

Target behavior:
- If the user uploads receipt media with payment text such as `cc bca`, `db bca`, `cc bri`, `db jago`, `db cash`, `cc jeni`, or `cash`, the bot detects it and shows the normalized method during confirmation.
- If the only detected hint is generic or ambiguous, such as `bca` or `edc bca`, the bot should not auto-save a method and should show the method picker instead.
- If no method is detected from the caption or OCR text, the confirmation keyboard lets the user choose a payment method directly.
- The selected payment method is saved into Google Sheets in a new `payment_method` column before `classification`.

## 2) Context
The current flow already works:

```text
Telegram receipt media
  -> OCR/model parse
  -> pending confirmation
  -> user confirms or rejects
  -> append row to receipts_raw
```

This RFC keeps that working flow and adds payment-method capture at the confirmation layer.

Current `receipts_raw` headers in `project-pwc`:

```text
receipt_id, message_id, merchant_name, receipt_date, total_amount, tax_amount,
clasification, currency, confidence, needs_review, tax_label_raw, month_key, raw_json
```

Required target headers:

```text
receipt_id, message_id, merchant_name, receipt_date, total_amount, tax_amount,
payment_method, classification, currency, confidence, needs_review, tax_label_raw,
month_key, raw_json
```

Note: the current sheet header uses `clasification`. This migration should rename it to `classification` while inserting `payment_method`.

## 3) Scope

In scope:
- Add `payment_method` to receipt payload validation and formatting.
- Add deterministic payment method detection from user caption and OCR text.
- Configure method options and aliases via environment variables.
- Add payment-method inline buttons to Telegram confirmation.
- Save chosen method to `receipts_raw`.
- Update monthly formulas that rely on classification column positions.

Out of scope:
- Bank account reconciliation.
- Card statement import.
- Automatic payment provider inference from historical spending.
- Item-level receipt parsing.
- Retroactive backfill of old rows, except optional manual cleanup after the schema is stable.

## 4) Payment Method Taxonomy

Initial normalized values:

```text
cc-bca
db-bca
cc-bri
db-jago
db-cash
bca
cc-jenius
cash
```

Recommended meaning:

| Value | Meaning |
| --- | --- |
| `cc-bca` | BCA credit card |
| `db-bca` | BCA debit card |
| `cc-bri` | BRI credit card |
| `db-jago` | Bank Jago debit |
| `db-cash` | Cash debit / cash-card rail |
| `bca` | BCA generic / unknown BCA rail |
| `cc-jenius` | Jenius credit card |
| `cash` | Cash / tunai |

The list must be configurable, because the user's active cards and wallets will change over time.

## 5) Environment Configuration

Add these environment variables:

```env
RECEIPT_PAYMENT_METHODS=cc-bca,db-bca,cc-bri,db-jago,db-cash,bca,cc-jenius,cash
RECEIPT_PAYMENT_METHOD_ALIASES=cc-bca=cc bca|credit bca|kartu kredit bca;db-bca=db bca|debit bca;cc-bri=cc bri|credit bri;db-jago=db jago|debit jago|jago;db-cash=db cash|debit cash;cc-jenius=cc jeni|cc jenius;cash=cash|tunai
RECEIPT_PAYMENT_AMBIGUOUS_ALIASES=bca|edc bca|bank bca
```

Parsing rules:
- `RECEIPT_PAYMENT_METHODS` is the ordered list used for confirmation buttons.
- `RECEIPT_PAYMENT_METHOD_ALIASES` maps normalized values to match phrases.
- `RECEIPT_PAYMENT_AMBIGUOUS_ALIASES` marks phrases that should trigger the picker instead of auto-selecting a method.
- Aliases are case-insensitive.
- Hyphen/space differences should be normalized, so `cc-bca`, `cc bca`, and `CC BCA` can match the same method.
- Unknown configured aliases for values not present in `RECEIPT_PAYMENT_METHODS` should fail config validation.

## 6) Detection Priority

Payment method is resolved in this order:

1. User caption text.
2. OCR/raw receipt text.
3. User inline-button selection.
4. Empty value only if no method was selected and the user explicitly confirms without method selection. This should not be the default Telegram UX.

Caption wins over OCR because the user may intentionally override ambiguous receipt text.
Specific aliases win over ambiguous aliases. If the best available signal is only `bca`, `edc bca`, or another configured ambiguous alias, treat payment method as unresolved and show the method picker.

Example:

```text
User sends image with caption: cc bca
OCR text contains: MODE PEMBAYARAN: EDC BCA
Result: cc-bca
```

Ambiguous example:

```text
User sends image without caption
OCR text contains: MODE PEMBAYARAN: EDC BCA
Result: show method picker
```

## 7) Confirmation UX

### 7.1 Method detected

If a method is detected, the preview should include:

```text
payment_method: cc-bca
```

Telegram inline keyboard:

```text
[Save cc-bca] [No]
```

`Save cc-bca` confirms and writes the current payload.
`No` rejects with the same behavior as today's reject path.

### 7.2 Method not detected

If no method is detected, the preview should say the payment method is empty or unknown.

Telegram inline keyboard:

```text
[cc-bca] [db-bca]
[cc-bri] [db-jago]
[db-cash] [bca]
[cc-jenius] [cash]
[No]
```

Clicking a method should:
1. Apply that method to the pending receipt payload.
2. Save the receipt immediately.
3. Return the same saved/duplicate/failure message used by the current confirm flow.

Clicking `No` rejects the pending receipt and makes no sheet change.

### 7.3 Fallback text commands

Keep non-inline fallback commands for environments where inline keyboard delivery fails:

```text
/receipt_confirm <token>
/receipt_reject <token>
/receipt_method <token> <payment_method>
```

## 8) Callback Contract

Current callbacks:

```text
receipt_confirm:<token>
receipt_reject:<token>
```

New callback:

```text
receipt_method:<token>:<payment_method>
```

Notes:
- Keep callback payloads compact.
- Telegram callback data must remain within Bot API limits.
- Payment method values should stay short, lowercase, and hyphenated.

## 9) Payload Contract Update

`receipt.v1.1` is extended with one field:

```json
{
  "payment_method": "cc-bca"
}
```

Recommended full placement:

```json
{
  "schema_version": "receipt.v1.1",
  "receipt_id": "<chat_id>:<message_id>",
  "source": {
    "platform": "telegram",
    "chat_id": "<string>",
    "message_id": "<string>",
    "received_at": "2026-07-01T00:00:00Z"
  },
  "merchant_name": "<string>",
  "receipt_date": "YYYY-MM-DD",
  "total_amount": 0,
  "tax_amount": 0,
  "payment_method": "cc-bca",
  "tax_label_raw": "PPN",
  "classification": "food",
  "currency": "IDR",
  "month_key": "YYYY-MM",
  "confidence": 0.95,
  "needs_review": false,
  "raw_json": {}
}
```

`raw_json` should include detection audit data:

```json
{
  "caption_text": "cc bca",
  "payment_method_source": "caption|ocr|button|none",
  "payment_method_matched_alias": "cc bca"
}
```

## 10) Google Sheets Migration

### 10.1 `receipts_raw`

Insert `payment_method` at column G, before `classification`.

Target columns:

| Col | Header | Notes |
| --- | --- | --- |
| A | `receipt_id` | Unique key for idempotency |
| B | `message_id` | Telegram message id |
| C | `merchant_name` | |
| D | `receipt_date` | `YYYY-MM-DD` |
| E | `total_amount` | Numeric |
| F | `tax_amount` | Numeric |
| G | `payment_method` | New field |
| H | `classification` | Rename from existing typo if needed |
| I | `currency` | Default `IDR` |
| J | `confidence` | 0-1 |
| K | `needs_review` | Boolean |
| L | `tax_label_raw` | Free text |
| M | `month_key` | `YYYY-MM` |
| N | `raw_json` | Stringified JSON |

Append range changes from:

```text
receipts_raw!A:M
```

to:

```text
receipts_raw!A:N
```

### 10.2 Monthly formulas

Any formula using `classification` from column G must be updated to column H.

Known formulas to review:
- `monthly_breakdown`
- `monthly_breakdown_v2`
- code path in `ensure_monthly_formula.ts`

Expected column references after migration:
- `receipt_date`: D
- `total_amount`: E
- `tax_amount`: F
- `payment_method`: G
- `classification`: H
- `month_key`: M

## 11) Code Areas

Likely implementation touch points:

| Area | Files |
| --- | --- |
| Env parsing | `openclaw-platform/src/config/env.ts` |
| Payment method resolver | `openclaw-platform/src/domains/receipts/receipt-payment-method.ts` |
| Payload construction | `openclaw-platform/src/usecases/receipt-assistant/build-receipt-payload.ts` |
| Payload schema | `openclaw-platform/src/domains/receipts/receipt.schema.ts` |
| Preview table | `openclaw-platform/src/domains/receipts/receipt-formatting.ts` |
| Pending confirmation | `openclaw-platform/src/usecases/receipt-assistant/receipt-confirmation-store.ts` |
| Confirmation handling | `openclaw-platform/src/usecases/receipt-assistant/handle-receipt-confirmation.ts` |
| Task confirmation type | `openclaw-platform/src/task-router/task.types.ts` |
| Receipt handler callback mapping | `openclaw-platform/src/handlers/receipt-assistant/receipt-assistant.handler.ts` |
| Telegram inline keyboard | `openclaw-platform/hooks/task-router/telegram.ts` |
| Trigger detection | `openclaw-platform/src/task-router/task-trigger.detector.ts` |
| Gate plugins | `openclaw-platform/plugins/receipt-gate/index.js`, `openclaw-platform/plugins/task-gate/index.js` |
| Sheets append | `openclaw-platform/src/integrations/google-sheets/append_receipt_row.ts` |
| Monthly formula bootstrap | `openclaw-platform/src/integrations/google-sheets/ensure_monthly_formula.ts` |
| Docs/env sample | `openclaw-platform/README.md`, `prod-env/openclaw-production.env` |

## 12) Rollout Plan

1. Add config parsing for methods and aliases.
2. Add resolver with unit-level examples for caption and OCR matching.
3. Extend receipt schema and preview formatting.
4. Extend confirmation actions with `method` decision.
5. Add Telegram method-picker keyboard.
6. Update trigger/gate regexes to allow `receipt_method` callbacks.
7. Update Sheets append from A:M to A:N.
8. Migrate the live sheet headers and formulas.
9. Run validation/build.
10. Test two flows:
    - image + caption `cc bca` detects and saves `cc-bca`
    - image with no method opens method buttons and saves selected method

## 13) Acceptance Criteria

This RFC is complete when:
- `receipts_raw` has a working `payment_method` column at G.
- Existing receipt confirmation still works.
- Caption `cc bca` saves as `cc-bca`.
- Caption `db bca` saves as `db-bca`.
- Caption `cc bri` saves as `cc-bri`.
- Caption `db jago` saves as `db-jago`.
- Caption `db cash` saves as `db-cash`.
- Caption `cc jeni` saves as `cc-jenius`.
- Caption `cash` saves as `cash`.
- No-method receipts show method buttons instead of only yes/no.
- `No` still rejects without saving.
- Monthly breakdown formulas still group by `classification`.

## 14) Risks And Decisions

Risk: inserting a column before `classification` breaks formulas and append order.
- Mitigation: migrate code and sheet formulas in the same rollout.

Risk: ambiguous text like `bca` could mean debit, credit, transfer, or EDC.
- Mitigation: keep `bca` as a manual button option, but treat generic `bca` / `edc bca` detection as ambiguous and show all method options.

Risk: too many payment methods make Telegram buttons noisy.
- Mitigation: keep `RECEIPT_PAYMENT_METHODS` ordered and short; revisit grouping only if the list becomes large.

Risk: old rows have no payment method.
- Mitigation: leave old rows blank unless a separate backfill is requested.

## 15) References

- RFC-001: `RFC-001-openclaw-telegram-receipt-assistant.md`
- Telegram Bot API inline keyboards: https://core.telegram.org/bots/api#inlinekeyboardmarkup
- Google Sheets API append: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
