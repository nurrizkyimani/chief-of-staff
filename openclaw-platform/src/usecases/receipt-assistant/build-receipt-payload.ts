import {
  applyPersonalClassificationOverride,
  type ClassificationDecision
} from "../../domains/receipts/receipt-classification.js";
import { buildMonthKey, normalizeReceiptDate } from "../../domains/receipts/receipt-date.js";
import { resolveReceiptPaymentMethod } from "../../domains/receipts/receipt-payment-method.js";
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
  sourceFileType?: "image" | "pdf";
  pdfPageNumber?: number;
  pdfTotalPages?: number | null;
  pdfTruncated?: boolean;
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
  const paymentMethodDecision = resolveReceiptPaymentMethod({
    captionText: input.captionText,
    ocrText: candidate.raw_text
  });

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
    payment_method: paymentMethodDecision.paymentMethod,
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
      source_file_type: input.sourceFileType ?? "image",
      ...(input.pdfPageNumber ? { pdf_page_number: input.pdfPageNumber } : {}),
      ...(input.pdfTotalPages !== undefined ? { pdf_total_pages: input.pdfTotalPages } : {}),
      ...(input.pdfTruncated !== undefined ? { pdf_truncated: input.pdfTruncated } : {}),
      ...(input.captionText ? { caption_text: input.captionText } : {}),
      payment_method_source: paymentMethodDecision.source,
      ...(paymentMethodDecision.matchedAlias
        ? { payment_method_matched_alias: paymentMethodDecision.matchedAlias }
        : {}),
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
