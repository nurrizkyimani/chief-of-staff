import { readFile } from "node:fs/promises";
import path from "node:path";

type ResultRow = {
  receipt_id: string;
  merchant_name: string;
  receipt_date: string;
  total_amount: number;
  tax_amount: number;
  classification: string;
  needs_review: boolean;
};

type ResultFile = {
  receipts: ResultRow[];
};

function parseArgs(): { baselinePath: string; sandboxPath: string } {
  const baselineIndex = process.argv.findIndex((arg) => arg === "--baseline");
  const sandboxIndex = process.argv.findIndex((arg) => arg === "--sandbox");

  const baselinePath = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : "";
  const sandboxPath = sandboxIndex >= 0 ? process.argv[sandboxIndex + 1] : "";

  if (!baselinePath || !sandboxPath) {
    throw new Error(
      "Usage: tsx src/scripts/compare_parity_results.ts --baseline ./baseline.json --sandbox ./sandbox.json"
    );
  }

  return { baselinePath, sandboxPath };
}

async function readResultFile(filePath: string): Promise<ResultFile> {
  const absolute = path.resolve(filePath);
  const raw = await readFile(absolute, "utf8");
  const parsed = JSON.parse(raw) as ResultFile;
  return { receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [] };
}

function compareRows(baseline: ResultRow, sandbox: ResultRow): string[] {
  const mismatches: string[] = [];
  if (baseline.merchant_name !== sandbox.merchant_name) mismatches.push("merchant_name");
  if (baseline.receipt_date !== sandbox.receipt_date) mismatches.push("receipt_date");
  if (baseline.total_amount !== sandbox.total_amount) mismatches.push("total_amount");
  if (baseline.tax_amount !== sandbox.tax_amount) mismatches.push("tax_amount");
  if (baseline.classification !== sandbox.classification) mismatches.push("classification");
  if (baseline.needs_review !== sandbox.needs_review) mismatches.push("needs_review");
  return mismatches;
}

async function main(): Promise<void> {
  const { baselinePath, sandboxPath } = parseArgs();
  const baseline = await readResultFile(baselinePath);
  const sandbox = await readResultFile(sandboxPath);

  const sandboxById = new Map<string, ResultRow>(sandbox.receipts.map((item) => [item.receipt_id, item]));
  const mismatches: string[] = [];
  let missing = 0;

  for (const baseRow of baseline.receipts) {
    const sandboxRow = sandboxById.get(baseRow.receipt_id);
    if (!sandboxRow) {
      missing += 1;
      mismatches.push(`${baseRow.receipt_id}: missing in sandbox output`);
      continue;
    }

    const fields = compareRows(baseRow, sandboxRow);
    if (fields.length > 0) {
      mismatches.push(`${baseRow.receipt_id}: ${fields.join(", ")}`);
    }
  }

  if (mismatches.length > 0) {
    console.error("Parity check failed.");
    console.error(`Missing rows: ${missing}`);
    for (const mismatch of mismatches) console.error(`- ${mismatch}`);
    process.exit(1);
  }

  console.log(`Parity check passed for ${baseline.receipts.length} receipts.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
