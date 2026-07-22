import assert from "node:assert/strict";
import type {
  FinanceDigestRepository,
  FinanceSourceResult,
  PaymentCalendarRow,
  ReceiptQualityRow,
  WeeklySpendRow
} from "../domains/finance/finance-digest.js";
import {
  parsePaymentCalendar,
  parseReceiptQuality,
  parseWeeklySpend
} from "../integrations/google-sheets/finance-digest-sheet-parser.js";
import { detectTaskTrigger } from "../task-router/task-trigger.detector.js";
import { formatFinanceDigest } from "../usecases/finance-digest/format-finance-digest.js";
import { getFinanceDigest } from "../usecases/finance-digest/get-finance-digest.js";

const ok = <T>(rows: T[], warnings: string[] = []): FinanceSourceResult<T> => ({ rows, warnings });

const repository: FinanceDigestRepository = {
  async readWeeklySpend() {
    return ok<WeeklySpendRow>([
      { weekStart: "2026-07-13", weekEnd: "2026-07-19", paymentMethod: "cc-bca", amountSpent: 320_000 },
      { weekStart: "2026-07-13", weekEnd: "2026-07-19", paymentMethod: "cc-bca", amountSpent: 5_000 },
      { weekStart: "2026-07-13", weekEnd: "2026-07-19", paymentMethod: "cc-jenius", amountSpent: 95_500 },
      { weekStart: "2026-07-06", weekEnd: "2026-07-12", paymentMethod: "cc-bca", amountSpent: 999_000 }
    ]);
  },
  async readPaymentCalendar() {
    return ok<PaymentCalendarRow>([
      { dueDate: "2026-07-20", paymentMethod: "cc-jenius", amountDue: 1_250_000 },
      { dueDate: "2026-07-15", paymentMethod: "cc-bca", amountDue: 880_000 },
      { dueDate: "2026-07-27", paymentMethod: "spaylater", amountDue: 210_000 },
      { dueDate: "2026-07-28", paymentMethod: "cc-bri", amountDue: 500_000 },
      { dueDate: "2026-07-12", paymentMethod: "cc-bca", amountDue: 100_000 }
    ]);
  },
  async readReceiptQuality() {
    return ok<ReceiptQualityRow>([
      { receiptDate: "2026-07-01", paymentMethod: "cc-bca", needsReview: false },
      { receiptDate: "2026-07-02", paymentMethod: "", needsReview: true },
      { receiptDate: "2026-06-30", paymentMethod: "", needsReview: true }
    ]);
  }
};

const digest = await getFinanceDigest(repository, {
  now: new Date("2026-07-13T01:00:00.000Z"),
  timezone: "Asia/Jakarta",
  lookaheadDays: 14
});

assert.equal(digest.localDate, "2026-07-13");
assert.deepEqual(digest.weeklySpend, [
  { paymentMethod: "cc-bca", amountSpent: 325_000 },
  { paymentMethod: "cc-jenius", amountSpent: 95_500 }
]);
assert.equal(digest.totalToReserve, 420_500);
assert.deepEqual(digest.upcomingPayments.map((row) => row.dueDate), [
  "2026-07-15",
  "2026-07-20",
  "2026-07-27"
]);
assert.deepEqual(digest.warnings, [
  "1 payment calendar date has passed; payment status is not tracked.",
  "1 receipt needs review.",
  "1 receipt has no payment method."
]);
assert.equal(digest.partial, false);
assert.equal(digest.unavailable, false);

const message = formatFinanceDigest(digest);
assert.match(message, /cc-bca: Rp325\.000/);
assert.match(message, /Total to reserve: Rp420\.500/);
assert.match(message, /cc-bca: Rp880\.000 due 15 Jul 2026/);
assert.doesNotMatch(message, /cc-bri/);

const partialRepository: FinanceDigestRepository = {
  ...repository,
  async readPaymentCalendar() {
    throw new Error("permission denied");
  }
};
const partial = await getFinanceDigest(partialRepository, {
  now: new Date("2026-07-13T01:00:00.000Z"),
  timezone: "Asia/Jakarta",
  lookaheadDays: 14
});
assert.equal(partial.partial, true);
assert.equal(partial.unavailable, false);
assert.match(formatFinanceDigest(partial), /Needs attention - partial data/);
assert.ok(partial.warnings.includes("Payment calendar data is unavailable."));

const unavailableRepository: FinanceDigestRepository = {
  async readWeeklySpend() {
    throw new Error("unavailable");
  },
  async readPaymentCalendar() {
    throw new Error("unavailable");
  },
  async readReceiptQuality() {
    throw new Error("unavailable");
  }
};
const unavailable = await getFinanceDigest(unavailableRepository, {
  now: new Date("2026-07-13T01:00:00.000Z"),
  timezone: "Asia/Jakarta",
  lookaheadDays: 14
});
assert.equal(unavailable.unavailable, true);
assert.equal(formatFinanceDigest(unavailable), "Finance summary is unavailable; no data was changed.");

const serial = (isoDate: string): number =>
  Math.floor((Date.parse(`${isoDate}T00:00:00.000Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

assert.deepEqual(
  parseWeeklySpend([
    ["amount_spent", "payment_method", "week_end", "week_start", "hidden_helper"],
    [320_000, "cc-bca", serial("2026-07-19"), serial("2026-07-13")],
    ["", "cc-jenius", "2026-07-19", "2026-07-13"],
    [-1, "cc-bri", "2026-07-19", "2026-07-13"],
    ["", "", "", "", "helper-only row"]
  ]),
  {
    rows: [
      { weekStart: "2026-07-13", weekEnd: "2026-07-19", paymentMethod: "cc-bca", amountSpent: 320_000 },
      { weekStart: "2026-07-13", weekEnd: "2026-07-19", paymentMethod: "cc-jenius", amountSpent: 0 }
    ],
    warnings: ["1 invalid weekly spend row(s) were excluded."]
  }
);

assert.deepEqual(
  parsePaymentCalendar([
    ["due_date", "payment_method", "amount_due"],
    ["2026-07-15", "cc-bca", "Rp880.000"]
  ]).rows,
  [{ dueDate: "2026-07-15", paymentMethod: "cc-bca", amountDue: 880_000 }]
);

assert.deepEqual(
  parseReceiptQuality([
    ["needs_review", "receipt_date", "payment_method"],
    [true, "2026-07-02", ""]
  ]).rows,
  [{ receiptDate: "2026-07-02", paymentMethod: "", needsReview: true }]
);

assert.throws(
  () => parseWeeklySpend([["week_start", "week_end", "payment_method"]]),
  /Missing required Sheet header: amount_spent/
);

assert.deepEqual(detectTaskTrigger("/finance", false), {
  kind: "finance-digest",
  source: "finance_command"
});
assert.deepEqual(detectTaskTrigger("/finance@my_bot", false), {
  kind: "finance-digest",
  source: "finance_command"
});

console.log("finance digest tests passed");
