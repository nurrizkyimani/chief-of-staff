import { env } from "../../config/env.js";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";
import { prependReceiptJournalEntry } from "../../integrations/spreadsheets/receipt-journal.adapter.js";
import { persistReceiptPayload } from "./save-receipt-row.js";

export type SinkSaveStatus = "saved" | "duplicate" | "skipped" | "failed";

export type SinkSaveResult = {
  enabled: boolean;
  status: SinkSaveStatus;
  error?: unknown;
};

export type ConfirmedReceiptSaveResult = {
  journal: SinkSaveResult;
  sheets: SinkSaveResult;
};

function mapAppendResultToSinkStatus(result: "appended" | "duplicate"): SinkSaveStatus {
  return result === "appended" ? "saved" : "duplicate";
}

export async function saveConfirmedReceipt(payload: ReceiptPayload): Promise<ConfirmedReceiptSaveResult> {
  const result: ConfirmedReceiptSaveResult = {
    journal: {
      enabled: env.RECEIPT_SAVE_JOURNAL,
      status: env.RECEIPT_SAVE_JOURNAL ? "failed" : "skipped"
    },
    sheets: {
      enabled: env.RECEIPT_SAVE_SHEETS,
      status: env.RECEIPT_SAVE_SHEETS ? "failed" : "skipped"
    }
  };

  if (env.RECEIPT_SAVE_JOURNAL) {
    try {
      result.journal.status = mapAppendResultToSinkStatus(await prependReceiptJournalEntry(payload));
    } catch (error) {
      result.journal.status = "failed";
      result.journal.error = error;
    }
  }

  if (env.RECEIPT_SAVE_SHEETS) {
    try {
      result.sheets.status = mapAppendResultToSinkStatus(await persistReceiptPayload(payload));
    } catch (error) {
      result.sheets.status = "failed";
      result.sheets.error = error;
    }
  }

  return result;
}

export function hasFailedEnabledSink(result: ConfirmedReceiptSaveResult): boolean {
  return Object.values(result).some((sink) => sink.enabled && sink.status === "failed");
}

export function formatConfirmedReceiptSaveMessage(
  result: ConfirmedReceiptSaveResult,
  receiptId: string,
  prefix: string
): string {
  const lines = [
    `${prefix}Journal: ${formatJournalSinkStatus(result.journal)}`,
    `Google Sheets: ${formatSheetsSinkStatus(result.sheets)}`,
    `Receipt: ${receiptId}`
  ];

  if (hasFailedEnabledSink(result)) {
    lines.push("Some enabled saves failed. You can retry this confirmation.");
  }

  return lines.join("\n");
}

function formatJournalSinkStatus(result: SinkSaveResult): string {
  if (!result.enabled || result.status === "skipped") return "Skipped by config.";
  if (result.status === "saved") return "Saved to receipt-journal.md.";
  if (result.status === "duplicate") return "Already recorded in receipt-journal.md.";
  return "Failed to save. Check receipt journal path and permissions.";
}

function formatSheetsSinkStatus(result: SinkSaveResult): string {
  if (!result.enabled || result.status === "skipped") return "Skipped by config.";
  if (result.status === "saved") return `Saved to ${env.RECEIPT_SHEET_RAW}.`;
  if (result.status === "duplicate") return `Already recorded in ${env.RECEIPT_SHEET_RAW}.`;
  return "Failed to save. Check Google Sheets configuration and permissions.";
}
