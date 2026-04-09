import { env } from "../../config/env.js";
import type { ReceiptPayload } from "../../assistants/receipt-assistant/schemas/receipt.v1.1.schema.js";
import { createSheetsClient } from "./sheets_client.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";

export type AppendReceiptResult = "appended" | "duplicate";

function toReceiptsRawRow(payload: ReceiptPayload): (string | number | boolean)[] {
  return [
    payload.receipt_id,
    payload.source.message_id,
    payload.merchant_name,
    payload.receipt_date,
    payload.total_amount,
    payload.tax_amount,
    payload.classification,
    payload.currency,
    payload.confidence,
    payload.needs_review,
    payload.tax_label_raw,
    payload.month_key,
    JSON.stringify(payload.raw_json)
  ];
}

export async function isDuplicateReceipt(receiptId: string): Promise<boolean> {
  try {
    const sheets = createSheetsClient();
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.RECEIPT_SHEET_RAW}!A:A`
    });

    const values = existing.data.values ?? [];
    return values.some((row) => row[0] === receiptId);
  } catch (error) {
    throw new ReceiptError("SHEETS_READ", "Could not read existing receipts from Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}

export async function appendReceiptsRawRow(payload: ReceiptPayload): Promise<AppendReceiptResult> {
  const duplicate = await isDuplicateReceipt(payload.receipt_id);
  if (duplicate) return "duplicate";

  try {
    const sheets = createSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      range: `${env.RECEIPT_SHEET_RAW}!A:M`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        majorDimension: "ROWS",
        values: [toReceiptsRawRow(payload)]
      }
    });
    return "appended";
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not append receipt into Google Sheets.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}
