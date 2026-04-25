import { readFile } from "node:fs/promises";
import path from "node:path";
import { runReceiptPipeline } from "../pipelines/receipt_pipeline.js";

type BackfillItem = {
  chatId: string;
  messageId: string;
  receivedAt: string;
  filePath: string;
  mimeType?: string;
};

type BackfillFile = {
  receipts: BackfillItem[];
};

function parseArgs(): { inputPath: string } {
  const inputIndex = process.argv.findIndex((arg) => arg === "--input");
  if (inputIndex === -1 || !process.argv[inputIndex + 1]) {
    throw new Error("Usage: tsx src/scripts/backfill_receipts.ts --input ./path/to/backfill.json");
  }
  return { inputPath: process.argv[inputIndex + 1] };
}

function inferMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function main(): Promise<void> {
  const { inputPath } = parseArgs();
  const absoluteInputPath = path.resolve(inputPath);
  const raw = await readFile(absoluteInputPath, "utf8");
  const parsed = JSON.parse(raw) as BackfillFile;
  const items = Array.isArray(parsed.receipts) ? parsed.receipts : [];

  if (items.length === 0) {
    console.log("No receipts to backfill.");
    return;
  }

  for (const item of items) {
    const absoluteFilePath = path.resolve(path.dirname(absoluteInputPath), item.filePath);
    const buffer = await readFile(absoluteFilePath);
    const mimeType = item.mimeType ?? inferMimeType(item.filePath);

    const result = await runReceiptPipeline({
      chatId: item.chatId,
      messageId: item.messageId,
      receivedAt: item.receivedAt,
      imageBase64: buffer.toString("base64"),
      mimeType
    });

    console.log(
      `${result.payload.receipt_id} -> ${result.appendResult} (${result.payload.merchant_name}, ${result.payload.total_amount})`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
