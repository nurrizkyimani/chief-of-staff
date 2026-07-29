import { env } from "../../config/env.js";
import { GogGmailReceiptSource } from "../../integrations/gmail/gog-gmail-receipt-source.js";
import { listReceiptIds } from "../../integrations/google-sheets/append_receipt_row.js";
import { handledTaskResult } from "../../task-router/task-handler.js";
import type { TaskHandler } from "../../task-router/task-handler.js";
import { presentReceiptConfirmations } from "../receipt-assistant/receipt-confirmation.presenter.js";
import {
  listPendingReceiptIds,
  prunePendingConfirmations
} from "../../usecases/receipt-assistant/receipt-confirmation-store.js";
import { processGmailReceiptImport } from "../../usecases/gmail-receipt-import/process-gmail-receipt-import.js";

export const gmailReceiptImportHandler: TaskHandler = {
  name: "gmail-receipt-import",
  canHandle(trigger) {
    return trigger.kind === "gmail-receipt-import";
  },
  async handle(_input, trigger, logger) {
    if (trigger.kind !== "gmail-receipt-import") {
      return handledTaskResult({ suppressReason: "gmail_receipt_import_unmatched" });
    }
    if (!env.GMAIL_RECEIPT_ENABLED) {
      return handledTaskResult({
        suppressReason: trigger.source,
        messages: ["Gmail receipt import is disabled."]
      });
    }
    if (!env.GMAIL_RECEIPT_ACCOUNT) {
      return handledTaskResult({
        suppressReason: trigger.source,
        messages: ["Set GMAIL_RECEIPT_ACCOUNT before you use /parse."]
      });
    }

    logger?.log("task_router.gmail_receipt.start", {
      account: env.GMAIL_RECEIPT_ACCOUNT,
      label: env.GMAIL_RECEIPT_LABEL,
      lookbackMinutes: env.GMAIL_RECEIPT_LOOKBACK_MINUTES
    });

    try {
      prunePendingConfirmations(env.RECEIPT_CONFIRMATION_TTL_MS);
      const result = await processGmailReceiptImport({
        account: env.GMAIL_RECEIPT_ACCOUNT,
        label: env.GMAIL_RECEIPT_LABEL,
        lookbackMinutes: env.GMAIL_RECEIPT_LOOKBACK_MINUTES,
        maxMessages: env.GMAIL_RECEIPT_MAX_MESSAGES,
        maxPdfPages: env.RECEIPT_MAX_PDF_PAGES,
        source: new GogGmailReceiptSource({ binary: env.GOG_BIN }),
        savedReceiptIds: env.RECEIPT_SAVE_SHEETS ? await listReceiptIds() : new Set(),
        pendingReceiptIds: listPendingReceiptIds()
      });

      return handledTaskResult({
        suppressReason: trigger.source,
        messages: [result.message],
        confirmations: presentReceiptConfirmations(result.confirmations)
      });
    } catch (error) {
      logger?.log("task_router.gmail_receipt.error", {
        error: error instanceof Error ? error.message : String(error)
      });
      return handledTaskResult({
        suppressReason: trigger.source,
        messages: [`Gmail receipt scan failed: ${error instanceof Error ? error.message : String(error)}`]
      });
    }
  }
};
