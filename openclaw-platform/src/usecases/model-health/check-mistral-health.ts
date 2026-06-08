import { env } from "../../config/env.js";

const WHITESPACE_SEQUENCE_PATTERN = /\s+/g;

export type MistralHealthResult =
  | {
      ok: true;
      model: string;
      servedModel: string;
      latencyMs: number;
      sample: string;
    }
  | {
      ok: false;
      model: string;
      latencyMs: number;
      status?: number;
      error: string;
      details?: string;
    };

export type ModelHealthLogger = {
  request(input: { endpoint: string; model: string }): void;
  response(input: { status: number; ok: boolean; latencyMs: number; bodyPreview: string }): void;
  invalidJson(input: { bodyPreview: string }): void;
  parseOk(input: {
    configuredModel: string;
    servedModel: string;
    rawContentType: string;
    samplePreview: string;
    latencyMs: number;
  }): void;
  requestError(input: { error: string }): void;
};

function safeErrorDetails(details: string): string {
  const trimmed = details.trim();
  if (!trimmed) return "";
  return trimmed.replace(WHITESPACE_SEQUENCE_PATTERN, " ").slice(0, 220);
}

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

function preview(value: string, max = 360): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export async function checkMistralHealth(logger?: ModelHealthLogger): Promise<MistralHealthResult> {
  const startedAt = Date.now();
  const model = env.RECEIPT_MODEL;
  const endpoint = `${env.MISTRAL_API_BASE}/v1/chat/completions`;

  logger?.request({ endpoint, model });

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

    logger?.response({
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
      logger?.invalidJson({ bodyPreview: preview(bodyText) });
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

    logger?.parseOk({
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
    logger?.requestError({
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

export function formatMistralHealthMessage(result: MistralHealthResult): string {
  if (result.ok === true) {
    return `Model connectivity: OK
Provider: mistral
Configured model: ${result.model}
Served model: ${result.servedModel}
Latency: ${result.latencyMs}ms
Sample: ${result.sample}`;
  }

  const statusLine = result.status ? `Status: ${result.status}\n` : "";
  const detailsLine = result.details ? `Details: ${result.details}\n` : "";
  return `Model connectivity: FAILED
Provider: mistral
Configured model: ${result.model}
${statusLine}${detailsLine}Error: ${result.error}
Latency: ${result.latencyMs}ms`;
}
