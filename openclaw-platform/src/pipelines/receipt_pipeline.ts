import type { ReceiptPayload } from "../domains/receipts/receipt.schema.js";
import type { AppendReceiptResult } from "../integrations/google-sheets/append_receipt_row.js";
import {
  buildReceiptPayload as buildReceiptPayloadUsecase,
  type BuildReceiptPayloadInput
} from "../usecases/receipt-assistant/build-receipt-payload.js";
import { persistReceiptPayload } from "../usecases/receipt-assistant/save-receipt-row.js";

export { persistReceiptPayload } from "../usecases/receipt-assistant/save-receipt-row.js";

export type ReceiptIntent = "receipt" | "income";

export type ReceiptIntentSource = "media_default" | "receipt_command" | "income_command";

export type ReceiptPipelineInput = {
  sourcePlatform?: string;
  chatId: string;
  messageId: string;
  receivedAt: string;
  imageBase64: string;
  mimeType: string;
  intent?: ReceiptIntent;
  intentSource?: ReceiptIntentSource;
  captionText?: string;
};

export type ReceiptPipelineResult = {
  payload: ReceiptPayload;
  appendResult: AppendReceiptResult;
};

export async function buildReceiptPayload(input: ReceiptPipelineInput): Promise<ReceiptPayload> {
  return buildReceiptPayloadUsecase({
    ...(input as BuildReceiptPayloadInput),
    sourcePlatform: input.sourcePlatform ?? "telegram"
  });
}

export async function runReceiptPipeline(input: ReceiptPipelineInput): Promise<ReceiptPipelineResult> {
  const payload = await buildReceiptPayload(input);
  const appendResult = await persistReceiptPayload(payload);
  return { payload, appendResult };
}
