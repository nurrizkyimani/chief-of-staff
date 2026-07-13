# RFC-005: Credit Card Weekly Payment Calendar

Status: Implemented
Date: 2026-07-05
Owner: nurrizky
Depends on: RFC-003 receipt payment method confirmation

## Summary

Create a Google Sheets planning layer for credit card and paylater cashflow. The goal is to answer two practical questions:

1. How much should I transfer this week into a holding account/card fund?
2. Which card or paylater payment is due in which week?

This should use existing `receipts_raw` data, especially `receipt_date`, `total_amount`, `payment_method`, and `classification`. No new receipt schema is required for v1.

## Implementation Notes

Implemented in `project-pwc` on 2026-07-05.

Created tabs:

```text
payment_method_config
cc_weekly_spend
cc_payment_calendar
```

`cc_weekly_spend` and `cc_payment_calendar` use hidden helper columns `J:M` to normalize matching `receipts_raw` rows before the visible summary formulas aggregate them. This avoids Google Sheets `QUERY` type inference issues on constructed arrays and keeps the visible tables easy to read.

## Accounting Styles

There are two possible accounting styles, and both are useful.

### Weekly Envelope Style

Every week, transfer exactly that week's credit card or paylater spending into a holding account/card fund.

Example:

```text
this week cc-jenius spent Rp95,500, transfer Rp95,500
```

This is simple and emotionally clean. It helps prevent credit card spending from feeling invisible.

### Due-Date Calendar Style

Group transactions into the correct card or paylater payment cycle, then show which week the payment is due.

Example:

```text
cc-jenius due on 21 July, need Rp1.25m ready that week
```

This is more accurate for actual payment planning because every card has a different due date.

## Recommendation

Build both views:

1. `cc_weekly_spend`
   Shows weekly envelope transfer amount by payment method.

2. `cc_payment_calendar`
   Shows due-date grouped amount by payment method and due week.

For v1, use due-day based grouping. Later, add `cutoff_day` support for exact billing-cycle grouping.

## Payment Method Config

Add a config tab:

```text
payment_method_config
```

Columns:

```text
payment_method
type
due_day
cutoff_day
active
comment
```

Initial rows:

```text
cc-bca     | cc       | 12 |   | TRUE | Due on day 12. Cutoff optional until exact cycle mode.
cc-jenius  | cc       | 21 |   | TRUE | Due on day 21. Cutoff optional until exact cycle mode.
spaylater  | paylater | 15 |   | TRUE | Due on day 15. Cutoff optional until exact cycle mode.
```

Column notes:

- `due_day`: Payment deadline day of month.
- `cutoff_day`: Optional statement cutoff day. When empty, v1 uses due-day approximation.
- `active`: Only active methods appear in weekly and due-date summaries.
- `comment`: Human note for card/paylater behavior.

## Weekly Envelope Table

Add a table or tab:

```text
cc_weekly_spend
```

Columns:

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

Column notes:

- `week_key`: Monday-based week label for the spend week.
- `amount_spent`: Total spending in that week for this payment method.
- `next_due_date`: Approximate next payment deadline based on `due_day`.
- `days_to_due`: How many days from today until `next_due_date`.
- `transfer_comment`: Weekly envelope style: transfer exactly this week's card/paylater spend into a holding account or card fund.

## Due-Date Calendar Table

Add a table or tab:

```text
cc_payment_calendar
```

Columns:

```text
due_week
due_date
payment_method
amount_due
source_period_start
source_period_end
payment_comment
```

Column notes:

- `due_week`: Week where the payment deadline lands.
- `due_date`: Card/paylater payment deadline.
- `amount_due`: Amount that should be ready before this due date.
- `source_period_start`: First receipt date included in this due bucket.
- `source_period_end`: Last receipt date included in this due bucket.
- `payment_comment`: Due-date calendar style: group transactions into the card/paylater cycle and show which week the payment is due.

## V1 Formula Logic

Use active payment methods from `payment_method_config`, then filter `receipts_raw` rows where:

```text
payment_method is active
type is cc or paylater
```

Weekly spend grouping:

```text
group by week_start, payment_method
sum total_amount
```

Due-date grouping v1:

```text
if DAY(receipt_date) <= due_day:
  due_date = DATE(YEAR(receipt_date), MONTH(receipt_date), due_day)
else:
  due_date = EDATE(DATE(YEAR(receipt_date), MONTH(receipt_date), due_day), 1)
```

Then group by:

```text
due_date, payment_method
```

## Future Exact Cycle Mode

When `cutoff_day` is filled, use billing-cycle logic instead of the due-day approximation.

Example:

```text
cc-jenius due_day = 21
cc-jenius cutoff_day = 1
```

Then transactions after the cutoff move to the next billing cycle.

This matters because the exact amount due is controlled by statement cycle, not only due date.

## Bot Notification Plan

No AI is needed for this feature.

The bot can run on a weekly schedule and read from the sheet:

1. Current week rows from `cc_weekly_spend`.
2. Upcoming due rows from `cc_payment_calendar`, for example the next 14 days.

Example Monday message:

```text
CC weekly transfer

Envelope this week:
- cc-bca: Rp320,000
- cc-jenius: Rp95,500
- spaylater: Rp0

Upcoming due:
- cc-bca due 12 Jul: Rp880,000
- spaylater due 15 Jul: Rp210,000
- cc-jenius due 21 Jul: Rp1,250,000
```

## Implementation Steps

1. Add `payment_method_config` tab with due day config and header notes.
2. Add `cc_weekly_spend` table/formula with weekly envelope comments.
3. Add `cc_payment_calendar` table/formula with due-date comments.
4. Verify `cc-bca`, `cc-jenius`, and `spaylater` rows appear correctly.
5. Add bot push later, using the same scheduled task pattern as Budget Guardrail.

## Acceptance Criteria

- `payment_method_config` contains `cc-bca`, `cc-jenius`, and `spaylater`.
- `cc_weekly_spend` shows weekly amount by payment method.
- `cc_payment_calendar` shows amount due by due date and due week.
- Header notes explain the two accounting styles.
- No change is required to `receipts_raw`.
- No AI is required for v1.

## Risks

- Due-day only grouping is an approximation until `cutoff_day` is configured.
- Refunds, reversals, and chargebacks may need later handling.
- Installments may need special treatment if they should appear by monthly obligation instead of original transaction date.
