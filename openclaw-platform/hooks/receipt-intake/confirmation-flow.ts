import {
  buildReceiptPayload,
  type ReceiptPipelineInput
} from "../../dist/pipelines/receipt_pipeline.js";
import {
  deletePendingConfirmation,
  getPendingConfirmation,
  prunePendingConfirmations,
  savePendingConfirmation
} from "./confirmations.ts";
import { formatConfirmationPreview, formatFailureMessage, prefixLabel } from "./formatting.ts";
import {
  formatConfirmedReceiptSaveMessage,
  hasFailedEnabledSink,
  saveConfirmedReceipt
} from "./save-confirmed.ts";
import { sendControlledText, sendTelegramInlineConfirmation } from "./telegram.ts";
import type { ConfirmationAction } from "./types.ts";

// handleConfirmation applies a saved receipt confirmation decision.
export async function handleConfirmation(
  event: any,
  action: ConfirmationAction,
  telegramChatId: string | null
): Promise<boolean> {
  prunePendingConfirmations();

  const pending = getPendingConfirmation(action.token);
  if (!pending) {
    await sendControlledText(
      event,
        telegramChatId,
        "Receipt confirmation token is missing or expired. Re-send the media to parse again."
      );
    return true;
  }

  if (action.decision === "reject") {
    deletePendingConfirmation(action.token);
    const prefix = prefixLabel(pending.mediaIndex, pending.totalMedia, pending.pageNumber, pending.totalPages);
    await sendControlledText(event, telegramChatId, `${prefix}No changes made. Receipt was not saved.`);
    return true;
  }

  try {
    const result = await saveConfirmedReceipt(pending.payload);
    const prefix = prefixLabel(pending.mediaIndex, pending.totalMedia, pending.pageNumber, pending.totalPages);
    const savedMessage = formatConfirmedReceiptSaveMessage(result, pending.payload.receipt_id, prefix);
    if (!hasFailedEnabledSink(result)) {
      deletePendingConfirmation(action.token);
    }
    await sendControlledText(event, telegramChatId, savedMessage);
  } catch (error) {
    await sendControlledText(event, telegramChatId, formatFailureMessage(error, pending.mediaIndex, pending.totalMedia));
  }

  return true;
}

// parseAndQueueReceipt parses receipt input and queues it for confirmation.
export async function parseAndQueueReceipt(
  input: ReceiptPipelineInput,
  telegramChatId: string | null,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number,
  responses: string[]
): Promise<boolean> {
  const payload = await buildReceiptPayload(input);
  const token = savePendingConfirmation(payload, mediaIndex, totalMedia, pageNumber, totalPages);
  const previewText = formatConfirmationPreview(payload, mediaIndex, totalMedia, pageNumber, totalPages);

  const sentWithButtons =
    telegramChatId !== null
      ? await sendTelegramInlineConfirmation(telegramChatId, previewText, token)
      : false;
  if (sentWithButtons) {
    return true;
  }

  responses.push(`${previewText}

Confirm: /receipt_confirm ${token}
Cancel: /receipt_reject ${token}`);
  return false;
}
