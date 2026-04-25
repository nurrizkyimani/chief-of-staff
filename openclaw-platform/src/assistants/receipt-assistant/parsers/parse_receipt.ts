import { env } from "../../../config/env.js";
import {
  applyPersonalClassificationOverride,
  receiptClassifications,
  type ClassificationDecision
} from "../classifiers/classify_receipt.js";
import { ReceiptError, getErrorStatus } from "../../../errors/receipt_errors.js";

export type ReceiptParseCandidate = {
  merchant_name: string;
  receipt_date: string;
  total_amount: number;
  tax_amount: number;
  tax_label_raw: string;
  classification?: unknown;
  raw_text: string;
  confidence: number;
};

const MODEL_MAX_ATTEMPTS = 3;
const MODEL_BASE_BACKOFF_MS = 750;
const MISTRAL_CHAT_COMPLETIONS_URL = "https://api.mistral.ai/v1/chat/completions";

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    merchant_name: { type: "string" },
    receipt_date: { type: "string" },
    total_amount: { type: "number" },
    tax_amount: { type: "number" },
    tax_label_raw: { type: "string" },
    classification: {
      type: "string",
      enum: receiptClassifications
    },
    raw_text: { type: "string" },
    confidence: { type: "number" }
  },
  required: [
    "merchant_name",
    "receipt_date",
    "total_amount",
    "tax_amount",
    "tax_label_raw",
    "classification",
    "raw_text",
    "confidence"
  ]
} as const;

const parserInstructions = `
You are a receipt parser.
Extract only from visible printed values.
Output strict JSON with keys:
merchant_name, receipt_date, total_amount, tax_amount, tax_label_raw, classification, raw_text, confidence.
Rules:
- receipt_date format: YYYY-MM-DD
- total_amount and tax_amount numeric only
- classification must be exactly one of: food, mobility, groceries, nonfood, subscription
- classification guidance:
  food = restaurants, cafes, bakeries, fast food, meals, drinks, food delivery
  mobility = ride hailing, fuel, parking, toll, public transport
  groceries = minimarkets, supermarkets, grocery or household staples shopping
  subscription = recurring digital services
  nonfood = clearly none of the other categories
- confidence between 0 and 1
- if tax not found set tax_amount=0 and tax_label_raw="NOT_EXIST"
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

function getNetworkCode(error: unknown): string {
  return String(
    (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code ??
      ""
  );
}

function isRetryableModelError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;

  const code = getNetworkCode(error);
  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

type MistralMessageContentPart = {
  type?: string;
  text?: string;
};

type MistralChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | MistralMessageContentPart[];
    };
  }>;
};

function contentToString(content: string | MistralMessageContentPart[] | undefined): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function callMistralParse(imageBase64: string, mimeType: string): Promise<string> {
  const response = await fetch(MISTRAL_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.RECEIPT_MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "receipt_parse_candidate",
          schema: RECEIPT_SCHEMA,
          strict: true
        }
      },
      messages: [
        {
          role: "system",
          content: parserInstructions
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Parse this receipt."
            },
            {
              type: "image_url",
              image_url: `data:${mimeType};base64,${imageBase64}`
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new ReceiptError("MODEL_PERMANENT", "Mistral request failed.", {
      status: response.status,
      metadata: {
        body: bodyText.slice(0, 800)
      }
    });
  }

  const payload = (await response.json()) as MistralChatResponse;
  const outputText = contentToString(payload.choices?.[0]?.message?.content);
  if (!outputText) {
    throw new ReceiptError("MODEL_PERMANENT", "Mistral returned empty output.");
  }

  return outputText;
}

async function callModelWithRetries(imageBase64: string, mimeType: string): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MODEL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callMistralParse(imageBase64, mimeType);
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
  const outputText = await callModelWithRetries(imageBase64, mimeType);

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

export function classifyReceiptFromCandidate(candidate: ReceiptParseCandidate): ClassificationDecision {
  return applyPersonalClassificationOverride(candidate.classification, candidate.merchant_name, candidate.raw_text);
}
