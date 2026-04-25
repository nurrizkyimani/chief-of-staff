import { readFile, writeFile } from "node:fs/promises";
import type { ReceiptPayload } from "../../dist/assistants/receipt-assistant/schemas/receipt.v1.1.schema.js";
import { logReceiptOutcome } from "../../dist/observability/receipt_logger.js";
import { RECEIPT_JOURNAL_PATH } from "./constants.js";
import { formatReceiptTable } from "./formatting.js";
import { logStep } from "./logging.js";

// formatJournalEntry formats a receipt payload for the markdown journal.
export function formatJournalEntry(payload: ReceiptPayload): string {
  return `## ${new Date().toISOString()} - ${payload.merchant_name} - ${payload.total_amount} ${payload.currency}

${formatReceiptTable(payload, 5000)}
`;
}

// prependReceiptJournalEntry saves a receipt at the top of the journal.
export async function prependReceiptJournalEntry(payload: ReceiptPayload): Promise<"appended" | "duplicate"> {
  let existing = "";
  try {
    existing = await readFile(RECEIPT_JOURNAL_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (existing.includes(payload.receipt_id)) {
    return "duplicate";
  }

  logStep("receipt.payload.full", {
    payload
  });

  const entry = formatJournalEntry(payload);
  const nextContent = existing.trim().length > 0 ? `${entry}\n${existing}` : `${entry}\n`;
  await writeFile(RECEIPT_JOURNAL_PATH, nextContent, "utf8");

  logReceiptOutcome({
    receipt_id: payload.receipt_id,
    outcome: "appended",
    merchant_name: payload.merchant_name,
    receipt_date: payload.receipt_date,
    classification: payload.classification,
    confidence: payload.confidence,
    needs_review: payload.needs_review,
    metadata: {
      journal_path: RECEIPT_JOURNAL_PATH
    }
  });

  return "appended";
}
