import OpenAI from "openai";
import { env } from "../../../config/env.js";
import { classifyReceipt } from "../classifiers/classify_receipt.js";
import { ReceiptError, getErrorStatus } from "../../../errors/receipt_errors.js";

export type ReceiptParseCandidate = {
  merchant_name: string;
  receipt_date: string;
  total_amount: number;
  tax_amount: number;
  tax_label_raw: string;
  raw_text: string;
  confidence: number;
};

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const MODEL_MAX_ATTEMPTS = 3;
const MODEL_BASE_BACKOFF_MS = 750;

const parserInstructions = `
You are a receipt parser.
Extract only from visible printed values.
Output strict JSON with keys:
merchant_name, receipt_date, total_amount, tax_amount, tax_label_raw, raw_text, confidence.
Rules:
- receipt_date format: YYYY-MM-DD
- total_amount and tax_amount numeric only
- confidence between 0 and 1
- if tax not found set tax_amount=0 and tax_label_raw=""
- If multiple total-like labels exist, apply this priority:
  1) Grand Total
  2) Total Bill
  3) Total Belanja
  4) TOTAL
  5) Bill
- Tax labels to recognize include:
  PB1, PBJT, Pajak Resto, PPN, VAT, GST, Tax, Service Charge, Serv. Charge
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableModelError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;

  const code = String((error as { code?: string })?.code ?? "");
  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

async function callModelWithRetries(imageBase64: string, mimeType: string) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MODEL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await openai.responses.create({
        model: env.RECEIPT_MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: parserInstructions }]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Parse this receipt." },
              {
                type: "input_image",
                image_url: `data:${mimeType};base64,${imageBase64}`,
                detail: "auto"
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "receipt_parse_candidate",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                merchant_name: { type: "string" },
                receipt_date: { type: "string" },
                total_amount: { type: "number" },
                tax_amount: { type: "number" },
                tax_label_raw: { type: "string" },
                raw_text: { type: "string" },
                confidence: { type: "number" }
              },
              required: [
                "merchant_name",
                "receipt_date",
                "total_amount",
                "tax_amount",
                "tax_label_raw",
                "raw_text",
                "confidence"
              ]
            },
            strict: true
          }
        }
      });
    } catch (error) {
      lastError = error;
      const retryable = isRetryableModelError(error);
      if (!retryable || attempt === MODEL_MAX_ATTEMPTS) break;

      const backoffMs = MODEL_BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(backoffMs);
    }
  }

  const retryable = isRetryableModelError(lastError);
  const status = getErrorStatus(lastError);
  if (retryable) {
    throw new ReceiptError("MODEL_TEMPORARY", "Temporary model provider error.", {
      cause: lastError,
      status,
      metadata: { attempts: MODEL_MAX_ATTEMPTS }
    });
  }

  throw new ReceiptError("MODEL_PERMANENT", "Model provider rejected the parsing request.", {
    cause: lastError,
    status
  });
}

export async function extractReceiptFromImage(imageBase64: string, mimeType: string): Promise<ReceiptParseCandidate> {
  const response = await callModelWithRetries(imageBase64, mimeType);

  const outputText = response.output_text;
  if (!outputText) {
    throw new ReceiptError("MODEL_PERMANENT", "Model returned empty output.");
  }

  try {
    return JSON.parse(outputText) as ReceiptParseCandidate;
  } catch (error) {
    throw new ReceiptError("MODEL_PERMANENT", "Model output could not be parsed as JSON.", {
      cause: error
    });
  }
}

export function normalizeReceiptDate(rawDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  const parts = rawDate.replace(/[./]/g, "-").split("-");
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 2 && c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  return rawDate;
}

export function buildMonthKey(receiptDate: string): string {
  return receiptDate.slice(0, 7);
}

export function classifyReceiptFromCandidate(candidate: ReceiptParseCandidate): ReturnType<typeof classifyReceipt> {
  return classifyReceipt(candidate.merchant_name, candidate.raw_text);
}
