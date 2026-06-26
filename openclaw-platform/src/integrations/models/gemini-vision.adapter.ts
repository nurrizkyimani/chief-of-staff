import { env } from "../../config/env.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import {
  parserInstructions,
  type ReceiptParseCandidate,
  type ReceiptParseIntent
} from "./mistral-receipt-parser.adapter.js";

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const MODEL_MAX_ATTEMPTS = 3;
const MODEL_BASE_BACKOFF_MS = 750;
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

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

function contentToString(payload: GeminiGenerateContentResponse): string {
  return (
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim() ?? ""
  );
}

async function callGeminiParse(imageBase64: string, mimeType: string, intent: ReceiptParseIntent, model: string) {
  if (!env.GEMINI_API_KEY) {
    throw new ReceiptError("MODEL_PERMANENT", "GEMINI_API_KEY is required for the Google receipt parser.");
  }

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY
  )}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: parserInstructions }]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: intent === "income" ? "Parse this income-related receipt or transfer record." : "Parse this receipt."
            },
            {
              inlineData: {
                mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new ReceiptError("MODEL_PERMANENT", "Google Gemini request failed.", {
      status: response.status,
      metadata: {
        body: bodyText.slice(0, 800)
      }
    });
  }

  const payload = (await response.json()) as GeminiGenerateContentResponse;
  const outputText = contentToString(payload);
  if (!outputText) {
    throw new ReceiptError("MODEL_PERMANENT", "Google Gemini returned empty output.");
  }

  return outputText;
}

async function callModelWithRetries(imageBase64: string, mimeType: string, intent: ReceiptParseIntent, model: string) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MODEL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callGeminiParse(imageBase64, mimeType, intent, model);
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

export async function parseReceiptImageWithGemini(
  imageBase64: string,
  mimeType: string,
  intent: ReceiptParseIntent = "receipt",
  model = "gemini-3.1-flash-lite"
): Promise<ReceiptParseCandidate> {
  const outputText = await callModelWithRetries(imageBase64, mimeType, intent, model);

  try {
    return JSON.parse(outputText) as ReceiptParseCandidate;
  } catch (error) {
    throw new ReceiptError("MODEL_PERMANENT", "Model output could not be parsed as JSON.", {
      cause: error
    });
  }
}
