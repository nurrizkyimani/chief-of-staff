import {
  applyPersonalClassificationOverride,
  type ClassificationDecision
} from "../../domains/receipts/receipt-classification.js";
import { buildMonthKey, normalizeReceiptDate } from "../../domains/receipts/receipt-date.js";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";
import { validateReceiptV11 } from "../../domains/receipts/receipt.schema.js";
import { readReceiptImage } from "./read-receipt-image.js";

export type ReceiptIntent = "receipt" | "income";

export type ReceiptIntentSource = "media_default" | "receipt_command" | "income_command";

export type BuildReceiptPayloadInput = {
  sourcePlatform: string;
  chatId: string;
  messageId: string;
  receivedAt: string;
  imageBase64: string;
  mimeType: string;
  intent?: ReceiptIntent;
  intentSource?: ReceiptIntentSource;
  captionText?: string;
};

export async function buildReceiptPayload(input: BuildReceiptPayloadInput): Promise<ReceiptPayload> {
  const intent = input.intent ?? "receipt";
  const candidate = await readReceiptImage({
    imageBase64: input.imageBase64,
    mimeType: input.mimeType,
    intent
  });
  const receiptDate = normalizeReceiptDate(candidate.receipt_date);
  const classificationDecision = classifyReceiptFromCandidate(candidate);
  const finalClassification =
    intent === "income"
      ? "income"
      : classificationDecision.finalClassification === "income"
        ? "nonfood"
        : classificationDecision.finalClassification;
  const classificationSource =
    intent === "income"
      ? "intent"
      : classificationDecision.finalClassification === "income"
        ? "fallback"
        : classificationDecision.classificationSource;

  return validateReceiptV11({
    schema_version: "receipt.v1.1",
    receipt_id: `${input.chatId}:${input.messageId}`,
    source: {
      platform: input.sourcePlatform,
      chat_id: input.chatId,
      message_id: input.messageId,
      received_at: input.receivedAt
    },
    merchant_name: candidate.merchant_name,
    receipt_date: receiptDate,
    total_amount: candidate.total_amount,
    tax_amount: candidate.tax_amount,
    tax_label_raw: candidate.tax_label_raw,
    classification: finalClassification,
    currency: "IDR",
    month_key: buildMonthKey(receiptDate),
    confidence: candidate.confidence,
    needs_review:
      candidate.confidence < 0.8 ||
      !candidate.merchant_name ||
      !candidate.receipt_date ||
      !candidate.total_amount,
    raw_json: {
      ocr_excerpt: candidate.raw_text,
      intent,
      intent_source: input.intentSource ?? "media_default",
      ...(input.captionText ? { caption_text: input.captionText } : {}),
      model_classification: classificationDecision.modelClassification,
      final_classification: finalClassification,
      classification_source: classificationSource,
      ...(classificationDecision.matchedOverride
        ? { matched_override: classificationDecision.matchedOverride }
        : {})
    }
  });
}

function classifyReceiptFromCandidate(candidate: {
  classification?: unknown;
  merchant_name: string;
  raw_text: string;
}): ClassificationDecision {
  return applyPersonalClassificationOverride(candidate.classification, candidate.merchant_name, candidate.raw_text);
}
