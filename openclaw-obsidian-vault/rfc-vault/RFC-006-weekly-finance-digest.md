---
title: RFC-006 - Weekly Finance Digest
date: 2026-07-13
status: Final
owner: nurrizky
depends_on:
  - RFC-003-receipt-payment-method-confirmation.md
  - RFC-005-credit-card-weekly-payment-calendar.md
---

# RFC-006: Weekly Finance Digest

## 1) Decision

Build a read-only finance digest that reads the existing Google Sheets planning tabs and sends a concise Telegram summary.

The first release has two entry points:

1. `/finance` for an on-demand summary.
2. A scheduled Monday summary using the same application use case and formatter.

The feature must not append, update, clear, or re-create any spreadsheet range. Google Sheets remains the source of truth for all calculations.

## 2) Goal

Answer three practical questions without requiring the user to open Google Sheets:

1. How much was spent through credit cards and paylater this week?
2. How much money should be reserved for those purchases?
3. Which payments are due soon?

The digest should also surface simple data-quality warnings that could make the summary incomplete.

Example:

```text
Finance summary - 13 Jul 2026

This week's card spend
- cc-bca: Rp320,000
- cc-jenius: Rp95,500
Total to reserve: Rp415,500

Upcoming payments
- cc-bca: Rp880,000 due 15 Jul
- cc-jenius: Rp1,250,000 due 21 Jul

Needs attention
- 2 receipts need review
- 1 receipt has no payment method
```

## 3) Why This Feature Is Next

RFC-005 already created the calculation layer in Google Sheets. This RFC only exposes those existing results through the bot.

This is intentionally lower risk than bank synchronization, automatic reconciliation, budget enforcement, or automatic payment actions because it:

- introduces no new financial input;
- does not change receipt or cicilan schemas;
- does not duplicate accounting formulas in TypeScript;
- does not use an AI model for financial calculations;
- does not write to Google Sheets;
- cannot move money or mark a bill as paid.

## 4) Scope

In scope:

- Add `/finance` as an explicit command.
- Read the current-week rows from `cc_weekly_spend`.
- Read upcoming rows from `cc_payment_calendar`.
- Read receipt quality signals from `receipts_raw`.
- Format Rupiah amounts and dates deterministically.
- Send the same digest on a weekly schedule.
- Return a clear partial-data warning when one source range cannot be read.
- Log operational errors without logging receipt raw JSON or credentials.

Out of scope:

- Editing any Google Sheets cell.
- Creating or repairing Sheet formulas.
- Bank, card, or e-wallet API synchronization.
- Importing statements.
- Automatic transaction reconciliation.
- AI-generated calculations or financial recommendations.
- Budget limits and budget alerts.
- Marking card bills as paid.
- Automatic transfers or other movement of money.
- Exact statement-balance reconciliation.
- WhatsApp delivery in the first release.

## 5) Google Sheets Read Contract

### 5.1 `cc_weekly_spend`

Required visible columns:

```text
week_key
week_start
week_end
payment_method
amount_spent
next_due_date
days_to_due
transfer_comment
```

Selection rules:

- Use the row set whose `week_start <= today <= week_end`.
- Include only rows with a non-empty `payment_method`.
- Treat blank `amount_spent` as zero.
- Reject non-numeric, negative, or non-finite amounts from totals and report a warning.
- Sum valid `amount_spent` values to produce `Total to reserve`.

### 5.2 `cc_payment_calendar`

Required visible columns:

```text
due_week
due_date
payment_method
amount_due
source_period_start
source_period_end
payment_comment
```

Selection rules:

- Include payments due from today through the configured lookahead window.
- Default lookahead is 14 calendar days.
- Sort ascending by `due_date`, then `payment_method`.
- Exclude past due dates from `Upcoming payments` and report them separately as overdue warnings.
- Reject invalid dates and invalid amounts from totals and report a warning.

### 5.3 `receipts_raw`

The first release reads only these fields for quality warnings:

```text
receipt_id
receipt_date
payment_method
needs_review
```

Quality checks:

- Count rows with `needs_review` equal to `true`.
- Count rows with an empty `payment_method`.
- Limit checks to the current calendar month so historical cleanup does not dominate the digest.
- Do not include merchant names, receipt IDs, or raw JSON in the scheduled message.

### 5.4 No Sheet Migration

RFC-006 requires no new tab, column, formula, protected range, or Sheet migration.

The application must use header names rather than fixed column letters. Reordered columns must not silently change the meaning of the digest.

## 6) Application Design

Use a small read-only pipeline:

```text
Google Sheets
  -> finance digest repository
  -> finance digest use case
  -> deterministic formatter
  -> Telegram presenter
```

The repository returns normalized values and source-level warnings. The use case selects the current week and lookahead window. The formatter performs presentation only.

The manual command and scheduled job must invoke the same use case. Scheduling must not contain separate finance logic.

Suggested internal result:

```ts
type FinanceDigest = {
  generatedAt: string;
  weeklySpend: Array<{
    paymentMethod: string;
    amountSpent: number;
  }>;
  totalToReserve: number;
  upcomingPayments: Array<{
    paymentMethod: string;
    amountDue: number;
    dueDate: string;
  }>;
  warnings: string[];
  partial: boolean;
};
```

## 7) Trigger and Delivery

### 7.1 Manual Command

Trigger:

```text
/finance
```

Rules:

- Only chats already authorized for the finance module may run it.
- Media is not required.
- The command performs no model call.
- The reply must state when no spend or no upcoming payment exists.

### 7.2 Scheduled Digest

Default schedule:

```text
Monday 08:00 Asia/Jakarta
```

Configuration:

```env
FINANCE_DIGEST_ENABLED=false
FINANCE_DIGEST_TIMEZONE=Asia/Jakarta
FINANCE_DIGEST_LOOKAHEAD_DAYS=14
FINANCE_DIGEST_TELEGRAM_CHAT_ID=
```

The scheduled digest remains disabled by default. Enable it only after the `/finance` output has been verified against the Sheet.

## 8) Formatting Rules

- Currency is Indonesian Rupiah with no decimal fraction.
- Dates are rendered in `d MMM yyyy` form.
- Payment methods use their normalized Sheet values.
- Zero-value payment methods may be omitted from the spend list.
- Show at most ten upcoming payments; if more exist, show the remaining count.
- Telegram messages must remain understandable without Markdown rendering.
- Do not infer missing values using an AI model.

## 9) Failure Behavior

The feature fails closed and remains read-only.

- If all required Sheet reads fail, reply: `Finance summary is unavailable; no data was changed.`
- If one source fails, return the available sections and mark the digest as partial.
- If headers are missing or duplicated, do not guess column positions.
- If a row has an invalid amount or date, exclude that row and add a warning.
- A scheduled failure must be logged once and must not retry in a tight loop.
- No error path may trigger a spreadsheet write.

## 10) Privacy and Security

- Use the existing Google service-account access.
- Do not add broader Google API scopes.
- Do not expose spreadsheet IDs, chat IDs, credentials, or raw row data in Telegram errors.
- Do not log `raw_json` or full receipt rows.
- Deliver scheduled messages only to the configured allowlisted Telegram chat.

## 11) Testing

Unit tests:

- Select the correct Monday-based current week.
- Sum valid weekly spend across multiple payment methods.
- Treat blank spend as zero.
- Reject invalid and negative amounts.
- Select payments inside the 14-day inclusive window.
- Sort payments by date and payment method.
- Report past payments as overdue warnings.
- Count current-month missing methods and review flags.
- Format Rupiah and dates deterministically.
- Produce partial output when one source fails.

Integration tests with fixture Sheet responses:

- All three tabs available.
- No spend this week.
- No upcoming payments.
- Missing required header.
- Empty Sheet tabs.
- Google API timeout or permission failure.

Manual acceptance test:

1. Run `/finance` with scheduling disabled.
2. Compare every amount and due date against the visible Sheet tabs.
3. Confirm that running the command does not modify Sheet revision history.
4. Enable the scheduled job in a test chat.
5. Confirm one scheduled delivery in `Asia/Jakarta`.
6. Enable delivery to the production finance chat.

## 12) Rollout

### Phase 1 - Manual Read Only

- Implement repository, use case, formatter, and `/finance` routing.
- Keep `FINANCE_DIGEST_ENABLED=false`.
- Verify output against Google Sheets.

### Phase 2 - Scheduled Read Only

- Configure the allowlisted target chat.
- Enable Monday delivery.
- Monitor delivery and Sheet-read errors.

### Phase 3 - Future RFCs

Any Sheet write, payment acknowledgement, exact statement reconciliation, subscription projection, or budget alert requires a separate RFC.

## 13) Acceptance Criteria

RFC-006 is implemented when:

- `/finance` returns the correct current-week spend and 14-day payment calendar.
- Totals match the visible Google Sheets values for the acceptance fixture.
- Quality warnings identify current-month missing payment methods and review rows.
- The command and scheduled delivery use one shared use case.
- The feature performs zero spreadsheet writes.
- Missing headers and invalid rows are reported without guessed results.
- Scheduling is disabled by default and uses `Asia/Jakarta` when enabled.
- Tests cover success, empty, partial, and failure cases.

## 14) Finalized Decisions

- Google Sheets is the calculation source of truth.
- RFC-006 is read-only.
- `/finance` ships before scheduled delivery is enabled.
- Monday 08:00 `Asia/Jakarta` is the default schedule.
- Upcoming payment lookahead is 14 calendar days.
- No AI model participates in finance calculations.
- No Sheet schema or formula changes are part of this RFC.
- Any action that changes financial state requires a separate RFC.
