import {
  appendReceiptsRawRow,
  type AppendReceiptResult
} from "../integrations/google-sheets/append_receipt_row.js";
import { ensureMonthlyBreakdownFormula } from "../integrations/google-sheets/ensure_monthly_formula.js";
import {
  buildMonthKey,
  classifyReceiptFromCandidate,
  extractReceiptFromImage,
  normalizeReceiptDate
} from "../assistants/receipt-assistant/parsers/parse_receipt.js";
import { validateReceiptV11 } from "../assistants/receipt-assistant/validators/validate_receipt.js";
import type { ReceiptPayload } from "../assistants/receipt-assistant/schemas/receipt.v1.1.schema.js";
import { logReceiptOutcome } from "../observability/receipt_logger.js";

export type ReceiptPipelineInput = {
  chatId: string;
  messageId: string;
  receivedAt: string;
  imageBase64: string;
  mimeType: string;
};

export type ReceiptPipelineResult = {
  payload: ReceiptPayload;
  appendResult: AppendReceiptResult;
};

export async function runReceiptPipeline(input: ReceiptPipelineInput): Promise<ReceiptPipelineResult> {
  const candidate = await extractReceiptFromImage(input.imageBase64, input.mimeType);
  const receiptDate = normalizeReceiptDate(candidate.receipt_date);
  const classification = classifyReceiptFromCandidate(candidate);

  const payload = validateReceiptV11({
    schema_version: "receipt.v1.1",
    receipt_id: `${input.chatId}:${input.messageId}`,
    source: {
      platform: "telegram",
      chat_id: input.chatId,
      message_id: input.messageId,
      received_at: input.receivedAt
    },
    merchant_name: candidate.merchant_name,
    receipt_date: receiptDate,
    total_amount: candidate.total_amount,
    tax_amount: candidate.tax_amount,
    tax_label_raw: candidate.tax_label_raw,
    classification,
    currency: "IDR",
    month_key: buildMonthKey(receiptDate),
    confidence: candidate.confidence,
    needs_review:
      candidate.confidence < 0.8 ||
      !candidate.merchant_name ||
      !candidate.receipt_date ||
      !candidate.total_amount,
    raw_json: {
      ocr_excerpt: candidate.raw_text
    }
  });

  const appendResult = await appendReceiptsRawRow(payload);
  await ensureMonthlyBreakdownFormula();

  logReceiptOutcome({
    receipt_id: payload.receipt_id,
    outcome: appendResult,
    merchant_name: payload.merchant_name,
    receipt_date: payload.receipt_date,
    classification: payload.classification,
    confidence: payload.confidence,
    needs_review: payload.needs_review
  });

  return { payload, appendResult };
}
