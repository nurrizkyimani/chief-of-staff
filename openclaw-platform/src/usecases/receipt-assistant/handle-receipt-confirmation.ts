import { env } from "../../config/env.js";
import { formatReceiptFailureMessage, prefixReceiptLabel } from "../../domains/receipts/receipt-formatting.js";
import type { ConfirmationAction } from "./receipt-confirmation-store.js";
import {
  deletePendingConfirmation,
  getPendingConfirmation,
  prunePendingConfirmations
} from "./receipt-confirmation-store.js";
import {
  formatConfirmedReceiptSaveMessage,
  hasFailedEnabledSink,
  saveConfirmedReceipt
} from "./save-confirmed-receipt.js";

export type ReceiptConfirmationResult = {
  handled: boolean;
  message?: string;
};

export async function handleReceiptConfirmation(action: ConfirmationAction): Promise<ReceiptConfirmationResult> {
  prunePendingConfirmations(env.RECEIPT_CONFIRMATION_TTL_MS);

  const pending = getPendingConfirmation(action.token);
  if (!pending) {
    return {
      handled: true,
      message: "Receipt confirmation token is missing or expired. Re-send the media to parse again."
    };
  }

  if (action.decision === "reject") {
    deletePendingConfirmation(action.token);
    const prefix = prefixReceiptLabel(
      pending.mediaIndex,
      pending.totalMedia,
      pending.pageNumber,
      pending.totalPages
    );
    return {
      handled: true,
      message: `${prefix}No changes made. Receipt was not saved.`
    };
  }

  try {
    const result = await saveConfirmedReceipt(pending.payload);
    const prefix = prefixReceiptLabel(
      pending.mediaIndex,
      pending.totalMedia,
      pending.pageNumber,
      pending.totalPages
    );
    if (!hasFailedEnabledSink(result)) {
      deletePendingConfirmation(action.token);
    }
    return {
      handled: true,
      message: formatConfirmedReceiptSaveMessage(result, pending.payload.receipt_id, prefix)
    };
  } catch (error) {
    return {
      handled: true,
      message: formatReceiptFailureMessage(error, pending.mediaIndex, pending.totalMedia)
    };
  }
}
