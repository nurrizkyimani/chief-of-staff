import {
  buildReceiptPayload,
  type ReceiptPipelineInput
} from "../../dist/pipelines/receipt_pipeline.js";
import {
  deletePendingConfirmation,
  getPendingConfirmation,
  prunePendingConfirmations,
  savePendingConfirmation
} from "./confirmations.js";
import { formatConfirmationPreview, formatFailureMessage, prefixLabel } from "./formatting.js";
import { prependReceiptJournalEntry } from "./journal.js";
import { sendControlledText, sendTelegramInlineConfirmation } from "./telegram.js";
import type { ConfirmationAction } from "./types.js";

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
      "Receipt confirmation token is missing or expired. Re-send /receipt with the image to parse again."
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
    const appendResult = await prependReceiptJournalEntry(pending.payload);
    deletePendingConfirmation(action.token);
    const prefix = prefixLabel(pending.mediaIndex, pending.totalMedia, pending.pageNumber, pending.totalPages);
    const savedMessage =
      appendResult === "duplicate"
        ? `${prefix}Already recorded in receipt-journal.md (${pending.payload.receipt_id}).`
        : `${prefix}Saved to receipt-journal.md (${pending.payload.receipt_id}).`;
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
