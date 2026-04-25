import { env } from "../../dist/config/env.js";
import { MISTRAL_API_BASE, WHITESPACE_SEQUENCE_PATTERN } from "./constants.ts";
import { logStep, preview } from "./logging.ts";
import type { MistralHealthResult } from "./types.ts";

// safeErrorDetails trims provider error details for user messages.
function safeErrorDetails(details: string): string {
  const trimmed = details.trim();
  if (!trimmed) return "";
  return trimmed.replace(WHITESPACE_SEQUENCE_PATTERN, " ").slice(0, 220);
}

// extractMistralContent extracts text content from a Mistral response.
function extractMistralContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: string }).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

// checkMistralHealth sends a small request to verify model connectivity.
export async function checkMistralHealth(): Promise<MistralHealthResult> {
  const startedAt = Date.now();
  const model = env.RECEIPT_MODEL;
  const endpoint = `${MISTRAL_API_BASE}/v1/chat/completions`;

  logStep("modelhealth.request", {
    endpoint,
    model
  });

  try {
    const requestBody = {
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        {
          role: "user",
          content: "Reply with exactly: OK"
        }
      ]
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();

    logStep("modelhealth.response", {
      status: response.status,
      ok: response.ok,
      latencyMs,
      bodyPreview: preview(bodyText)
    });

    if (!response.ok) {
      return {
        ok: false,
        model,
        latencyMs,
        status: response.status,
        error: `HTTP ${response.status}`,
        details: safeErrorDetails(bodyText)
      };
    }

    let payload: {
      model?: string;
      choices?: Array<{ message?: { content?: unknown } }>;
    } = {};

    try {
      payload = JSON.parse(bodyText) as typeof payload;
    } catch {
      logStep("modelhealth.parse.invalid_json", {
        bodyPreview: preview(bodyText)
      });
      return {
        ok: false,
        model,
        latencyMs,
        error: "Invalid JSON response from Mistral API."
      };
    }

    const rawContent = payload.choices?.[0]?.message?.content;
    const sample = extractMistralContent(rawContent).slice(0, 120) || "(empty)";
    const servedModel = String(payload.model ?? model);

    logStep("modelhealth.parse.ok", {
      configuredModel: model,
      servedModel,
      rawContentType: Array.isArray(rawContent) ? "array" : typeof rawContent,
      samplePreview: preview(sample),
      latencyMs
    });

    return {
      ok: true,
      model,
      servedModel,
      latencyMs,
      sample
    };
  } catch (error) {
    logStep("modelhealth.request.error", {
      error: (error as Error)?.message ?? "Unknown network error"
    });
    return {
      ok: false,
      model,
      latencyMs: Date.now() - startedAt,
      error: (error as Error)?.message ?? "Unknown network error"
    };
  }
}

// formatMistralHealthMessage formats the model health result for Telegram.
export function formatMistralHealthMessage(result: MistralHealthResult): string {
  if (result.ok === true) {
    return `Model connectivity: OK
Provider: mistral
Configured model: ${result.model}
Served model: ${result.servedModel}
Latency: ${result.latencyMs}ms
Sample: ${result.sample}`;
  }

  const failure = result as Extract<MistralHealthResult, { ok: false }>;
  const statusLine = failure.status ? `Status: ${failure.status}\n` : "";
  const detailsLine = failure.details ? `Details: ${failure.details}\n` : "";
  return `Model connectivity: FAILED
Provider: mistral
Configured model: ${failure.model}
${statusLine}${detailsLine}Error: ${failure.error}
Latency: ${failure.latencyMs}ms`;
}
