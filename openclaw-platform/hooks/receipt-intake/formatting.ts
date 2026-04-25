import type { ReceiptPayload } from "../../dist/assistants/receipt-assistant/schemas/receipt.v1.1.schema.js";
import { ReceiptError } from "../../dist/errors/receipt_errors.js";
import { MARKDOWN_TABLE_LINE_BREAK_PATTERN, MARKDOWN_TABLE_PIPE_PATTERN } from "./constants.ts";

// prefixLabel formats attachment and page labels for user messages.
export function prefixLabel(mediaIndex: number, totalMedia: number, pageNumber: number, totalPages: number): string {
  const parts: string[] = [];
  if (totalMedia > 1) parts.push(`Attachment ${mediaIndex + 1}/${totalMedia}`);
  if (totalPages > 1) parts.push(`Page ${pageNumber}/${totalPages}`);
  if (parts.length === 0) return "";
  return `[${parts.join(" · ")}] `;
}

// truncateText shortens text to a maximum length.
function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

// tableCell escapes and trims one markdown table cell.
function tableCell(value: unknown, max = 240): string {
  const text = value === undefined || value === null ? "" : String(value);
  return truncateText(text, max)
    .replace(MARKDOWN_TABLE_LINE_BREAK_PATTERN, " ")
    .replace(MARKDOWN_TABLE_PIPE_PATTERN, "\\|")
    .trim();
}

// receiptRowValues maps a receipt payload into journal table rows.
export function receiptRowValues(payload: ReceiptPayload, rawJsonMax: number): Array<[string, string, string]> {
  return [
    ["A", "receipt_id", payload.receipt_id],
    ["B", "message_id", payload.source.message_id],
    ["C", "merchant_name", payload.merchant_name],
    ["D", "receipt_date", payload.receipt_date],
    ["E", "total_amount", payload.total_amount.toString()],
    ["F", "tax_amount", payload.tax_amount.toString()],
    ["G", "classification", payload.classification],
    ["H", "currency", payload.currency],
    ["I", "confidence", payload.confidence.toString()],
    ["J", "needs_review", payload.needs_review ? "TRUE" : "FALSE"],
    ["K", "tax_label_raw", payload.tax_label_raw],
    ["L", "month_key", payload.month_key],
    ["M", "raw_json", truncateText(JSON.stringify(payload.raw_json), rawJsonMax)]
  ];
}

// formatReceiptTable formats a receipt payload as a markdown table.
export function formatReceiptTable(payload: ReceiptPayload, rawJsonMax: number): string {
  const rows = receiptRowValues(payload, rawJsonMax)
    .map(([col, header, value]) => `| ${col} | \`${header}\` | ${tableCell(value, col === "M" ? rawJsonMax : 240)} |`)
    .join("\n");

  return `| Col | Header | Value |
| --- | --- | --- |
${rows}`;
}

// formatConfirmationPreview formats the unsaved receipt preview message.
export function formatConfirmationPreview(
  payload: ReceiptPayload,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, pageNumber, totalPages);
  const isIncome = payload.classification === "income";
  const label = isIncome ? "income record" : "receipt";
  return `${prefix}Parsed ${label} (not saved yet)

${formatReceiptTable(payload, 320)}

Save this ${label} to enabled destinations?`;
}

// formatFailureMessage formats a user-safe receipt failure message.
export function formatFailureMessage(error: unknown, mediaIndex: number, totalMedia: number): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, 1, 1);

  if (error instanceof ReceiptError) {
    const receiptError = error as ReceiptError;
    if (receiptError.code === "UNSUPPORTED_MEDIA") {
      return `${prefix}Unsupported file type. Send receipt media, or use /income with media for income.`;
    }
    if (receiptError.code === "PDF_DISABLED") {
      return `${prefix}PDF intake is currently disabled. Send an image receipt, or use /income with an image for income.`;
    }
    if (receiptError.code === "PDF_CONVERSION") {
      return `${prefix}Could not process PDF. Install poppler-utils (pdftoppm/pdfinfo) on the gateway host.`;
    }
    if (receiptError.code === "MODEL_TEMPORARY") {
      return `${prefix}Temporary parsing error from model provider. Retry in a minute.`;
    }
    if (receiptError.code === "MODEL_PERMANENT") {
      return `${prefix}Could not parse receipt reliably; marked for review.`;
    }
    if (receiptError.code === "SHEETS_READ" || receiptError.code === "SHEETS_WRITE") {
      return `${prefix}Could not save to sheet; check Google Sheets configuration and permissions.`;
    }
    if (receiptError.code === "MEDIA_FETCH") {
      if (receiptError.status === 413) {
        return `${prefix}File is too large for processing. Send a smaller image/PDF.`;
      }
      return `${prefix}Could not download attachment from Telegram.`;
    }
  }

  return `${prefix}Receipt processing failed. Please retry.`;
}
