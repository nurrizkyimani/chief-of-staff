import { env } from "../../config/env.js";
import { formatReceiptConfirmationPreview } from "../../domains/receipts/receipt-formatting.js";
import { buildReceiptPayload, type BuildReceiptPayloadInput } from "./build-receipt-payload.js";
import { savePendingConfirmation } from "./receipt-confirmation-store.js";

export type ReceiptConfirmationRequest = {
  token: string;
  previewText: string;
  mediaIndex: number;
  totalMedia: number;
  pageNumber: number;
  totalPages: number;
};

export async function parseAndQueueReceiptConfirmation(
  input: BuildReceiptPayloadInput,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): Promise<ReceiptConfirmationRequest> {
  const payload = await buildReceiptPayload(input);
  const token = savePendingConfirmation(
    payload,
    mediaIndex,
    totalMedia,
    pageNumber,
    totalPages,
    env.RECEIPT_CONFIRMATION_TTL_MS
  );
  const previewText = formatReceiptConfirmationPreview(payload, mediaIndex, totalMedia, pageNumber, totalPages);

  return {
    token,
    previewText,
    mediaIndex,
    totalMedia,
    pageNumber,
    totalPages
  };
}
