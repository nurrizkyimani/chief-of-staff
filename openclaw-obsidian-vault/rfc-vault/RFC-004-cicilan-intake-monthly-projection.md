---
title: RFC-004 - Cicilan Intake And Monthly Projection
date: 2026-07-03
status: Draft
owner: nurrizky
depends_on:
  - RFC-003-receipt-payment-method-confirmation.md
---

# RFC-004: Cicilan Intake And Monthly Breakdown V2 Projection

## 1) Goal
Build cicilan as a separate text-only intake pipeline. `cicilan_raw` stores one master row per cicilan plan, while `monthly_breakdown_v2` performs monthly projection and shows `cicilan` beside normal monthly classifications.

## 2) Cicilan Raw Schema

```text
cicilan_id, message_id, merchant_name, cicilan_date, total_amount,
payment_method, classification, confidence, tenor_months, month_key, raw_json
```

Rules:
- Rupiah is implicit.
- No `needs_review` column for v1.
- `classification` is always `cicilan`.
- Missing tenor defaults to `1`.
- Missing interest defaults to `0%` inside `raw_json`.
- `monthly_breakdown_v2` computes `ROUND(total_amount / tenor_months)`.

## 3) Trigger
Process only explicit cicilan text:

```text
cicil
cicilan
installment
paylater
spaylater
spl
```

Image/OCR cicilan parsing is out of scope for v1.

## 4) Confirmation UX
Parsed preview shows merchant, total amount, tenor, projected monthly amount, payment method, and start month.

If payment method is known:

```text
[Save cc-bca] [No]
```

If payment method is missing or ambiguous, show the existing payment-method picker.

Callbacks:

```text
cicilan_confirm:<token>
cicilan_reject:<token>
cicilan_method:<token>:<payment_method>
```

## 5) Monthly Breakdown V2
Update `monthly_breakdown_v2` so the main classification detail and pivot combine:
- receipt rows from `receipts_raw`
- projected cicilan rows from `cicilan_raw`

The pivot should show `cicilan` as a normal classification column beside `dopamine`, `food`, `groceries`, `mobility`, `nonfood`, and `subscription`.

Each cicilan row expands into `tenor_months` projected months:

```text
month = month_key + installment offset
classification = cicilan
amount = ROUND(total_amount / tenor_months)
tax = 0
count = cicilan_id
```

## 6) Test Cases
- `cicilan cc bca anytime fitness 5999k 12 kali 0%`
- `cicil cc jenius uniqlo 5,090,234 12 bulan`
- `cicil spaylater uniqlo 5,090,234 12x`
- Missing tenor defaults to 1.
- Missing interest defaults to `0%`.
- Duplicate `cicilan_id` does not append twice.
- `monthly_breakdown_v2` shows a `cicilan` column in the main pivot.
