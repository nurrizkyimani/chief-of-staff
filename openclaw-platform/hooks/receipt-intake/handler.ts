import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReceiptPayload,
  type ReceiptPipelineInput
} from "../../dist/pipelines/receipt_pipeline.js";
import type { ReceiptPayload } from "../../dist/assistants/receipt-assistant/schemas/receipt.v1.1.schema.js";
import { ReceiptError, getErrorStatus } from "../../dist/errors/receipt_errors.js";
import { rasterizePdfBufferToJpegPages } from "../../dist/media/pdf_rasterizer.js";
import { logReceiptOutcome } from "../../dist/observability/receipt_logger.js";
import { env } from "../../dist/config/env.js";

type MediaCandidate = {
  url: string;
  mimeType?: string;
  sourceId?: string;
};

type MediaReadResult = {
  binary: Buffer;
  mimeType: string;
  resolvedFrom: string;
};

type PendingConfirmation = {
  token: string;
  payload: ReceiptPayload;
  mediaIndex: number;
  totalMedia: number;
  pageNumber: number;
  totalPages: number;
  createdAtMs: number;
};

type ConfirmationAction = {
  token: string;
  decision: "confirm" | "reject";
};

type MistralHealthResult =
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

const MAX_PDF_PAGES = env.RECEIPT_MAX_PDF_PAGES;
const PENDING_CONFIRMATION_TTL_MS = 30 * 60 * 1000;
const TELEGRAM_API_BASE = "https://api.telegram.org";
const MISTRAL_API_BASE = "https://api.mistral.ai";
const CALLBACK_CONFIRM_PREFIX = "receipt_confirm:";
const CALLBACK_REJECT_PREFIX = "receipt_reject:";
const LOG_PREFIX = "[receipt-intake]";
const LOG_PREVIEW_MAX = 360;
const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HOOK_DIR, "../../..");
const OPENCLAW_PLATFORM_ROOT = resolve(HOOK_DIR, "../..");
const OPENCLAW_HOME_ROOT = env.OPENCLAW_HOME
  ? resolve(env.OPENCLAW_HOME)
  : resolve(OPENCLAW_PLATFORM_ROOT, ".openclaw-home");
const RECEIPT_JOURNAL_PATH = resolve(PROJECT_ROOT, "obsidian-vault/md-db/receipt-journal.md");
const pendingConfirmations = new Map<string, PendingConfirmation>();

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function preview(value: unknown, max = LOG_PREVIEW_MAX): string {
  if (value === undefined) return "(undefined)";
  if (value === null) return "(null)";

  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    text = String(value);
  } else {
    text = safeJson(value);
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "(empty)";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function logStep(step: string, data?: Record<string, unknown>): void {
  if (!data) {
    console.info(`${LOG_PREFIX} ${step}`);
    return;
  }
  console.info(`${LOG_PREFIX} ${step} ${safeJson(data)}`);
}

function describeMessageShape(messages: unknown[]): string[] {
  return messages.slice(0, 12).map((item) => {
    if (item === null) return "null";
    if (Array.isArray(item)) return "array";
    if (typeof item === "object") {
      const keys = Object.keys(item as Record<string, unknown>).slice(0, 4);
      return keys.length > 0 ? `object{${keys.join(",")}}` : "object{}";
    }
    return typeof item;
  });
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter((item) => item.trim().length > 0)
      .join("");
  }

  if (typeof value === "object") {
    const candidate = value as {
      text?: unknown;
      content?: unknown;
      value?: unknown;
      message?: { content?: unknown };
    };

    if (typeof candidate.text === "string") return candidate.text;
    if (candidate.content !== undefined) return toText(candidate.content);
    if (candidate.value !== undefined) return toText(candidate.value);
    if (candidate.message?.content !== undefined) return toText(candidate.message.content);

    return safeJson(value);
  }

  return String(value);
}

function pickText(event: any): string {
  return (
    event?.context?.bodyForAgent ??
    event?.context?.content ??
    event?.context?.text ??
    ""
  );
}

function pushMessage(event: any, text: string): void {
  if (!Array.isArray(event?.messages)) return;

  const normalizedText = toText(text).trim();
  const beforeCount = event.messages.length;
  const beforeShape = describeMessageShape(event.messages);

  const retained = event.messages
    .filter((item) => typeof item === "string")
    .map((item) => (item as string).trim())
    .filter((item) => item.length > 0);

  const next = normalizedText.length > 0 ? [...retained, normalizedText] : retained;
  event.messages.splice(0, event.messages.length, ...next);

  logStep("pushMessage", {
    beforeCount,
    beforeShape,
    retainedStrings: retained.length,
    pushedPreview: preview(normalizedText),
    afterCount: event.messages.length
  });
}

function pickChatId(event: any): string {
  const metadata = event?.context?.metadata ?? {};
  return String(
    metadata.chatId ??
      metadata.conversationId ??
      event?.context?.conversationId ??
      event?.context?.senderId ??
      event?.context?.groupId ??
      metadata.channelId ??
      event?.context?.channelId ??
      event?.context?.from?.id ??
      event?.context?.from ??
      event?.sessionKey ??
      "unknown-chat"
  );
}

function extractNumericTelegramId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const candidates = [
    raw,
    raw.replace(/^(telegram|tg):/i, ""),
    raw.replace(/^(telegram|tg):group:/i, "")
  ];

  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized) continue;

    const direct = normalized.match(/^-?\d+$/);
    if (direct) return direct[0];

    const withTopic = normalized.match(/^(-?\d+):topic:\d+$/i);
    if (withTopic?.[1]) return withTopic[1];

    const withSender = normalized.match(/^(-?\d+):sender:-?\d+$/i);
    if (withSender?.[1]) return withSender[1];

    const withTopicAndSender = normalized.match(/^(-?\d+):topic:\d+:sender:-?\d+$/i);
    if (withTopicAndSender?.[1]) return withTopicAndSender[1];
  }

  return null;
}

function pickTelegramAllowedFromId(event: any): string | null {
  const cfg = event?.context?.cfg;
  const candidates = [
    cfg?.channels?.telegram?.allowFrom,
    cfg?.channels?.telegram?.groupAllowFrom,
    cfg?.telegram?.allowFrom,
    cfg?.telegram?.groupAllowFrom
  ];

  for (const candidate of candidates) {
    const values = Array.isArray(candidate) ? candidate : [candidate];
    for (const value of values) {
      const id = extractNumericTelegramId(value);
      if (id) return id;
    }
  }

  return null;
}

function pickTelegramSendChatId(event: any): string | null {
  const metadata = event?.context?.metadata ?? {};
  const context = event?.context ?? {};
  const from = event?.context?.from ?? {};
  const metadataFrom = metadata.from ?? {};
  const metadataChat = metadata.chat ?? {};
  const metadataMessage = metadata.message ?? {};
  const metadataUpdate = metadata.update ?? {};
  const contextRaw = context.raw ?? {};
  const contextMessage = context.message ?? {};
  const contextChat = context.chat ?? {};
  const contextSender = context.sender ?? {};
  const candidates = [
    metadata.chatId,
    metadata.conversationId,
    metadata.groupId,
    metadata.targetChatId,
    metadata.userId,
    metadata.senderId,
    metadata.fromId,
    metadata.telegramChatId,
    metadata.telegramUserId,
    metadata.chat_id,
    metadata.user_id,
    metadata.sender_id,
    metadataChat.id,
    metadataMessage.chat?.id,
    metadataUpdate.message?.chat?.id,
    metadataUpdate.callback_query?.message?.chat?.id,
    metadataFrom.id,
    metadata.from,
    metadata.to,
    context.chatId,
    context.conversationId,
    context.groupId,
    context.targetChatId,
    context.userId,
    context.senderId,
    contextSender.id,
    contextChat.id,
    contextMessage.chat?.id,
    contextRaw.message?.chat?.id,
    contextRaw.callback_query?.message?.chat?.id,
    context.from,
    context.to,
    from.id,
    from.chatId,
    from.conversationId,
    from.groupId,
    from.userId,
    from.senderId
  ];

  for (const candidate of candidates) {
    const normalized = extractNumericTelegramId(candidate);
    if (normalized) return normalized;
  }

  const fallback = extractNumericTelegramId(pickChatId(event));
  if (fallback) return fallback;

  const allowFromFallback = pickTelegramAllowedFromId(event);
  if (allowFromFallback) return allowFromFallback;

  return null;
}

function pickMessageId(event: any): string {
  const metadata = event?.context?.metadata ?? {};
  return String(
    metadata.messageId ??
      event?.context?.messageId ??
      event?.context?.from?.messageId ??
      event?.timestamp ??
      Date.now()
  );
}

function includesTelegramTag(value: unknown): boolean {
  return String(value ?? "").toLowerCase().includes("telegram");
}

function isTelegramEvent(event: any): boolean {
  const metadata = event?.context?.metadata ?? {};
  const candidates = [
    metadata.platform,
    metadata.provider,
    metadata.channelId,
    event?.context?.channelId,
    event?.context?.from?.provider,
    event?.context?.from?.channelId,
    event?.sessionKey
  ];
  return candidates.some(includesTelegramTag);
}

function normalizeMimeType(candidateMime: string | undefined, url: string): string {
  const fromCandidate = String(candidateMime ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (fromCandidate) return fromCandidate;

  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith(".pdf")) return "application/pdf";
  if (lowerUrl.endsWith(".png")) return "image/png";
  if (lowerUrl.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function candidateLocalPaths(rawPath: string): string[] {
  const clean = rawPath.trim();
  if (!clean) return [];

  const normalized = clean.startsWith("file://")
    ? fileURLToPath(clean)
    : clean;

  const paths = new Set<string>();
  if (isAbsolute(normalized)) {
    paths.add(normalized);
  } else {
    paths.add(resolve(process.cwd(), normalized));
    paths.add(resolve(OPENCLAW_PLATFORM_ROOT, normalized));
    paths.add(resolve(OPENCLAW_HOME_ROOT, normalized));
    paths.add(resolve(OPENCLAW_HOME_ROOT, ".openclaw", normalized));
    paths.add(resolve(OPENCLAW_HOME_ROOT, ".openclaw", "workspace", normalized));
  }

  return [...paths];
}

async function readMediaCandidate(media: MediaCandidate): Promise<MediaReadResult> {
  if (/^https?:\/\//i.test(media.url)) {
    const response = await fetch(media.url);
    if (!response.ok) {
      throw new ReceiptError("MEDIA_FETCH", "Could not download media.", {
        status: response.status
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      binary: Buffer.from(arrayBuffer),
      mimeType: normalizeMimeType(media.mimeType ?? response.headers.get("content-type") ?? undefined, media.url),
      resolvedFrom: media.url
    };
  }

  const attempts = candidateLocalPaths(media.url);
  let lastError: unknown;
  for (const candidatePath of attempts) {
    try {
      return {
        binary: await readFile(candidatePath),
        mimeType: normalizeMimeType(media.mimeType, candidatePath),
        resolvedFrom: candidatePath
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new ReceiptError("MEDIA_FETCH", "Could not read local media file.", {
    cause: lastError,
    status: getErrorStatus(lastError)
  });
}

function sanitizeToken(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "");
  return clean.slice(0, 24) || "media";
}

function deriveMessageId(
  baseMessageId: string,
  candidate: MediaCandidate,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const hasMany = totalMedia > 1 || totalPages > 1;
  if (!hasMany && !candidate.sourceId) return baseMessageId;

  const mediaSuffix = candidate.sourceId ? sanitizeToken(candidate.sourceId) : `m${mediaIndex + 1}`;
  if (totalPages > 1) {
    return `${baseMessageId}:${mediaSuffix}:p${pageNumber}`;
  }
  return `${baseMessageId}:${mediaSuffix}`;
}

function collectMediaCandidates(event: any, text: string): MediaCandidate[] {
  const metadata = event?.context?.metadata ?? {};
  const context = event?.context ?? {};
  const collected: MediaCandidate[] = [];

  const addCandidate = (raw: unknown): void => {
    if (!raw) return;

    if (Array.isArray(raw)) {
      raw.forEach(addCandidate);
      return;
    }

    if (typeof raw === "string") {
      collected.push({ url: raw });
      return;
    }

    if (typeof raw !== "object") return;

    const candidate = raw as Record<string, unknown>;
    const urlValue =
      candidate.url ??
      candidate.mediaUrl ??
      candidate.attachmentUrl ??
      candidate.fileUrl ??
      candidate.downloadUrl ??
      candidate.filePath ??
      candidate.path ??
      candidate.mediaPath;

    if (typeof urlValue !== "string" || !urlValue) return;

    const mimeTypeValue = candidate.mimeType ?? candidate.contentType ?? candidate.type;
    const sourceIdValue = candidate.fileId ?? candidate.mediaId ?? candidate.id ?? candidate.telegramFileId;

    collected.push({
      url: urlValue,
      mimeType: typeof mimeTypeValue === "string" ? mimeTypeValue : undefined,
      sourceId: sourceIdValue !== undefined ? String(sourceIdValue) : undefined
    });
  };

  addCandidate(metadata.mediaUrl);
  addCandidate(metadata.attachmentUrl);
  addCandidate(metadata.fileUrl);
  addCandidate(metadata.media);
  addCandidate(metadata.mediaUrls);
  addCandidate(metadata.attachments);

  addCandidate(context.media);
  addCandidate(context.attachment);
  addCandidate(context.attachments);
  addCandidate(
    context.mediaPath
      ? {
          mediaPath: context.mediaPath,
          mimeType: context.mediaType,
          id: context.messageId
        }
      : undefined
  );

  const unique = new Map<string, MediaCandidate>();
  for (const item of collected) {
    const dedupeKey = `${item.url}::${item.sourceId ?? ""}`;
    if (!unique.has(dedupeKey)) {
      unique.set(dedupeKey, item);
    }
  }

  if (unique.size === 0) {
    const urlMatches = [...text.matchAll(/https?:\/\/\S+/g)].map((match) => match[0]);
    for (const url of urlMatches) {
      const key = `${url}::`;
      if (!unique.has(key)) {
        unique.set(key, { url });
      }
    }
  }

  return [...unique.values()];
}

function prefixLabel(mediaIndex: number, totalMedia: number, pageNumber: number, totalPages: number): string {
  const parts: string[] = [];
  if (totalMedia > 1) parts.push(`Attachment ${mediaIndex + 1}/${totalMedia}`);
  if (totalPages > 1) parts.push(`Page ${pageNumber}/${totalPages}`);
  if (parts.length === 0) return "";
  return `[${parts.join(" · ")}] `;
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function tableCell(value: unknown, max = 240): string {
  const text = value === undefined || value === null ? "" : String(value);
  return truncateText(text, max)
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function receiptRowValues(payload: ReceiptPayload, rawJsonMax: number): Array<[string, string, string]> {
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

function formatReceiptTable(payload: ReceiptPayload, rawJsonMax: number): string {
  const rows = receiptRowValues(payload, rawJsonMax)
    .map(([col, header, value]) => `| ${col} | \`${header}\` | ${tableCell(value, col === "M" ? rawJsonMax : 240)} |`)
    .join("\n");

  return `| Col | Header | Value |
| --- | --- | --- |
${rows}`;
}

function formatConfirmationPreview(
  payload: ReceiptPayload,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, pageNumber, totalPages);
  return `${prefix}Parsed receipt (not saved yet)

${formatReceiptTable(payload, 320)}

Save this row to receipt-journal.md?`;
}

function formatJournalEntry(payload: ReceiptPayload): string {
  return `## ${new Date().toISOString()} - ${payload.merchant_name} - ${payload.total_amount} ${payload.currency}

${formatReceiptTable(payload, 5000)}
`;
}

async function prependReceiptJournalEntry(payload: ReceiptPayload): Promise<"appended" | "duplicate"> {
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

function formatFailureMessage(error: unknown, mediaIndex: number, totalMedia: number): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, 1, 1);

  if (error instanceof ReceiptError) {
    const receiptError = error as ReceiptError;
    if (receiptError.code === "UNSUPPORTED_MEDIA") {
      return `${prefix}Unsupported file type. Send /receipt with a photo/image.`;
    }
    if (receiptError.code === "PDF_DISABLED") {
      return `${prefix}PDF intake is currently disabled. Send /receipt with a photo/image.`;
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

function isReceiptCommand(text: string): boolean {
  return /(^|\s)\/receipt(?:\s|$)/i.test(text);
}

function isModelHealthCommand(text: string): boolean {
  return /(^|\s)\/modelhealth(?:@\w+)?(?:\s|$)/i.test(text);
}

function safeErrorDetails(details: string): string {
  const trimmed = details.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\s+/g, " ").slice(0, 220);
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

async function checkMistralHealth(): Promise<MistralHealthResult> {
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

function formatMistralHealthMessage(result: MistralHealthResult): string {
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

function parseConfirmationAction(text: string): ConfirmationAction | null {
  const normalized = text.trim();

  if (normalized.startsWith(CALLBACK_CONFIRM_PREFIX)) {
    return {
      decision: "confirm",
      token: normalized.slice(CALLBACK_CONFIRM_PREFIX.length)
    };
  }
  if (normalized.startsWith(CALLBACK_REJECT_PREFIX)) {
    return {
      decision: "reject",
      token: normalized.slice(CALLBACK_REJECT_PREFIX.length)
    };
  }

  const callbackMatch = normalized.match(/^callback_data:\s*(.+)$/i);
  const callbackPayload = callbackMatch?.[1]?.trim() ?? "";
  if (callbackPayload.startsWith(CALLBACK_CONFIRM_PREFIX)) {
    return {
      decision: "confirm",
      token: callbackPayload.slice(CALLBACK_CONFIRM_PREFIX.length)
    };
  }
  if (callbackPayload.startsWith(CALLBACK_REJECT_PREFIX)) {
    return {
      decision: "reject",
      token: callbackPayload.slice(CALLBACK_REJECT_PREFIX.length)
    };
  }

  const confirmMatch = normalized.match(/^\/receipt_confirm\s+([A-Za-z0-9_-]+)$/i);
  if (confirmMatch?.[1]) {
    return {
      decision: "confirm",
      token: confirmMatch[1]
    };
  }

  const rejectMatch = normalized.match(/^\/receipt_reject\s+([A-Za-z0-9_-]+)$/i);
  if (rejectMatch?.[1]) {
    return {
      decision: "reject",
      token: rejectMatch[1]
    };
  }

  return null;
}

function prunePendingConfirmations(nowMs: number = Date.now()): void {
  for (const [token, pending] of pendingConfirmations.entries()) {
    if (nowMs - pending.createdAtMs > PENDING_CONFIRMATION_TTL_MS) {
      pendingConfirmations.delete(token);
    }
  }
}

function createConfirmationToken(): string {
  const rand = randomBytes(8).toString("base64url").replace(/[^A-Za-z0-9_-]/g, "");
  return rand.slice(0, 12) || `${Date.now().toString(36)}`;
}

function savePendingConfirmation(
  payload: ReceiptPayload,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  prunePendingConfirmations();

  let token = createConfirmationToken();
  while (pendingConfirmations.has(token)) {
    token = createConfirmationToken();
  }

  pendingConfirmations.set(token, {
    token,
    payload,
    mediaIndex,
    totalMedia,
    pageNumber,
    totalPages,
    createdAtMs: Date.now()
  });

  return token;
}

async function sendTelegramInlineConfirmation(chatId: string, text: string, token: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  try {
    logStep("telegram.inline.request", {
      chatId,
      token,
      textPreview: preview(text)
    });

    const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Yes",
                callback_data: `${CALLBACK_CONFIRM_PREFIX}${token}`
              },
              {
                text: "No",
                callback_data: `${CALLBACK_REJECT_PREFIX}${token}`
              }
            ]
          ]
        }
      })
    });

    const responseBody = await response.text();
    logStep("telegram.inline.response", {
      chatId,
      status: response.status,
      ok: response.ok,
      bodyPreview: preview(responseBody)
    });

    return response.ok;
  } catch (error) {
    logStep("telegram.inline.error", {
      chatId,
      error: (error as Error)?.message ?? "Unknown sendMessage error"
    });
    return false;
  }
}

async function sendTelegramTextMessage(chatId: string, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  try {
    logStep("telegram.text.request", {
      chatId,
      textPreview: preview(text)
    });

    const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    const responseBody = await response.text();
    logStep("telegram.text.response", {
      chatId,
      status: response.status,
      ok: response.ok,
      bodyPreview: preview(responseBody)
    });

    return response.ok;
  } catch (error) {
    logStep("telegram.text.error", {
      chatId,
      error: (error as Error)?.message ?? "Unknown sendMessage error"
    });
    return false;
  }
}

function suppressDownstreamProcessing(event: any, reason: string): void {
  const context = event?.context;
  const noReply = "NO_REPLY";

  if (context && typeof context === "object") {
    const mutable = context as Record<string, unknown>;
    const keys = [
      "bodyForAgent",
      "bodyForCommands",
      "content",
      "text",
      "body",
      "rawBody",
      "commandBody",
      "transcript"
    ];
    for (const key of keys) {
      mutable[key] = noReply;
    }
  }

  if (Array.isArray(event?.messages)) {
    event.messages.splice(0, event.messages.length);
  }

  logStep("event.suppress_downstream", {
    reason,
    token: noReply
  });
}

async function sendControlledText(event: any, telegramChatId: string | null, text: string): Promise<void> {
  const sentDirect = telegramChatId !== null ? await sendTelegramTextMessage(telegramChatId, text) : false;
  if (!sentDirect) {
    pushMessage(event, text);
  }
}

async function handleConfirmation(
  event: any,
  action: ConfirmationAction,
  telegramChatId: string | null
): Promise<boolean> {
  prunePendingConfirmations();

  const pending = pendingConfirmations.get(action.token);
  if (!pending) {
    await sendControlledText(
      event,
      telegramChatId,
      "Receipt confirmation token is missing or expired. Re-send /receipt with the image to parse again."
    );
    return true;
  }

  if (action.decision === "reject") {
    pendingConfirmations.delete(action.token);
    const prefix = prefixLabel(pending.mediaIndex, pending.totalMedia, pending.pageNumber, pending.totalPages);
    await sendControlledText(event, telegramChatId, `${prefix}No changes made. Receipt was not saved.`);
    return true;
  }

  try {
    const appendResult = await prependReceiptJournalEntry(pending.payload);
    pendingConfirmations.delete(action.token);
    const prefix = prefixLabel(pending.mediaIndex, pending.totalMedia, pending.pageNumber, pending.totalPages);
    const savedMessage =
      appendResult === "duplicate"
        ? `${prefix}Already recorded in receipt-journal.md (${pending.payload.receipt_id}).`
        : `${prefix}Saved to receipt-journal.md (${pending.payload.receipt_id}).`;
    await sendControlledText(event, telegramChatId, savedMessage);
  } catch (error) {
    await sendControlledText(event, telegramChatId, formatFailureMessage(error, pending.mediaIndex, pending.totalMedia));
  }

  return true;
}

async function parseAndQueueReceipt(
  input: ReceiptPipelineInput,
  telegramChatId: string | null,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number,
  responses: string[]
): Promise<boolean> {
  const payload = await buildReceiptPayload(input);
  const token = savePendingConfirmation(payload, mediaIndex, totalMedia, pageNumber, totalPages);
  const previewText = formatConfirmationPreview(payload, mediaIndex, totalMedia, pageNumber, totalPages);

  const sentWithButtons =
    telegramChatId !== null
      ? await sendTelegramInlineConfirmation(telegramChatId, previewText, token)
      : false;
  if (sentWithButtons) {
    return true;
  }

  responses.push(`${previewText}

Confirm: /receipt_confirm ${token}
Cancel: /receipt_reject ${token}`);
  return false;
}

const handler = async (event: any) => {
  if (event?.type !== "message" || event?.action !== "preprocessed") return;
  if (!isTelegramEvent(event)) return;

  logStep("event.start", {
    type: event?.type,
    action: event?.action,
    channelId: event?.context?.channelId,
    sessionKey: event?.sessionKey,
    messageShape: Array.isArray(event?.messages) ? describeMessageShape(event.messages) : ["not-array"],
    textPreview: preview(pickText(event))
  });

  const text = pickText(event).trim();
  const telegramChatId = pickTelegramSendChatId(event);
  const confirmationAction = parseConfirmationAction(text);
  if (confirmationAction) {
    logStep("event.confirmation", {
      decision: confirmationAction.decision,
      token: confirmationAction.token
    });
    suppressDownstreamProcessing(event, "receipt_confirmation");
    await handleConfirmation(event, confirmationAction, telegramChatId);
    return;
  }

  if (isModelHealthCommand(text)) {
    suppressDownstreamProcessing(event, "modelhealth_command");
    logStep("event.modelhealth.command", {
      command: text
    });
    const health = await checkMistralHealth();
    const healthMessage = formatMistralHealthMessage(health);
    logStep("event.modelhealth.output", {
      ok: health.ok,
      outputPreview: preview(healthMessage)
    });
    logStep("event.modelhealth.telegram_target", {
      resolvedChatId: telegramChatId ?? "(null)",
      fallbackChatId: pickChatId(event),
      sampleIds: {
        metadataChatId: event?.context?.metadata?.chatId ?? null,
        metadataConversationId: event?.context?.metadata?.conversationId ?? null,
        metadataUserId: event?.context?.metadata?.userId ?? null,
        metadataFromId: event?.context?.metadata?.fromId ?? null,
        fromId: event?.context?.from?.id ?? null,
        fromChatId: event?.context?.from?.chatId ?? null,
        contextConversationId: event?.context?.conversationId ?? null,
        contextSenderId: event?.context?.senderId ?? null,
        contextGroupId: event?.context?.groupId ?? null,
        contextFrom: event?.context?.from ?? null,
        contextChatId: event?.context?.chatId ?? null,
        rawMessageChatId: event?.context?.raw?.message?.chat?.id ?? null,
        cfgAllowFrom: event?.context?.cfg?.channels?.telegram?.allowFrom ?? null
      },
      metadataKeys: Object.keys(event?.context?.metadata ?? {}).slice(0, 20),
      contextKeys: Object.keys(event?.context ?? {}).slice(0, 20),
      fromKeys: Object.keys(event?.context?.from ?? {}).slice(0, 20)
    });
    const sentDirect =
      telegramChatId !== null
        ? await sendTelegramTextMessage(telegramChatId, healthMessage)
        : false;

    if (!sentDirect) {
      pushMessage(event, healthMessage);
      logStep("event.modelhealth.fallback_pushMessage");
      return;
    }

    suppressDownstreamProcessing(event, "modelhealth_direct_send");
    return;
  }

  if (!isReceiptCommand(text)) {
    suppressDownstreamProcessing(event, "unsupported_telegram_message");
    await sendControlledText(event, telegramChatId, "Unsupported message. Use /receipt with an image or /modelhealth.");
    return;
  }

  const mediaCandidates = collectMediaCandidates(event, text);
  suppressDownstreamProcessing(event, "receipt_command");
  logStep("event.receipt.media_candidates", {
    count: mediaCandidates.length,
    candidates: mediaCandidates.map((candidate) => ({
      url: preview(candidate.url, 120),
      mimeType: candidate.mimeType ?? "(none)",
      sourceId: candidate.sourceId ?? "(none)"
    }))
  });

  if (mediaCandidates.length === 0) {
    const message = "Send /receipt together with a photo/image.";
    await sendControlledText(event, telegramChatId, message);
    return;
  }

  const chatId = pickChatId(event);
  const baseMessageId = pickMessageId(event);
  const receivedAt = new Date(event?.timestamp ?? Date.now()).toISOString();
  const responses: string[] = [];
  let sentDirectConfirmation = false;

  const hintedImages = mediaCandidates.filter((media) => normalizeMimeType(media.mimeType, media.url).startsWith("image/"));
  const hintedPdfs = mediaCandidates.filter((media) => normalizeMimeType(media.mimeType, media.url) === "application/pdf");
  const hintedUnknown = mediaCandidates.filter((media) => {
    const mime = normalizeMimeType(media.mimeType, media.url);
    return !mime.startsWith("image/") && mime !== "application/pdf";
  });

  const imageFirstCandidates = hintedImages.length > 0 ? [...hintedImages, ...hintedUnknown] : mediaCandidates;
  const skippedPdfCount = hintedImages.length > 0 ? hintedPdfs.length : 0;
  if (skippedPdfCount > 0) {
    responses.push(`Ignored ${skippedPdfCount} PDF attachment(s). Image-first mode is active.`);
  }

  for (let mediaIndex = 0; mediaIndex < imageFirstCandidates.length; mediaIndex += 1) {
    const media = imageFirstCandidates[mediaIndex];

    try {
      logStep("event.receipt.fetch.start", {
        mediaIndex,
        total: imageFirstCandidates.length,
        url: preview(media.url, 160),
        hintedMime: media.mimeType ?? "(none)"
      });

      const { binary, mimeType, resolvedFrom } = await readMediaCandidate(media);

      logStep("event.receipt.fetch.ok", {
        mediaIndex,
        sizeBytes: binary.byteLength,
        mimeType,
        isPdf: mimeType === "application/pdf",
        resolvedFrom: preview(resolvedFrom, 160)
      });

      const isPdf = mimeType === "application/pdf";
      const isImage = mimeType.startsWith("image/");
      if (!isPdf && !isImage) {
        throw new ReceiptError("UNSUPPORTED_MEDIA", `Unsupported media type: ${mimeType}`);
      }
      if (isPdf && (env.RECEIPT_STRICT_MEMORY_ONLY || !env.RECEIPT_ACCEPT_PDF)) {
        throw new ReceiptError("PDF_DISABLED", "PDF parsing is disabled in image-first mode.");
      }

      if (isPdf) {
        const pages = await rasterizePdfBufferToJpegPages(binary, MAX_PDF_PAGES);
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const page = pages[pageIndex];
          const messageId = deriveMessageId(
            baseMessageId,
            media,
            mediaIndex,
            imageFirstCandidates.length,
            page.pageNumber,
            pages.length
          );

          const input: ReceiptPipelineInput = {
            chatId,
            messageId,
            receivedAt,
            imageBase64: page.imageBase64,
            mimeType: page.mimeType
          };

          const sentDirect = await parseAndQueueReceipt(
            input,
            telegramChatId,
            mediaIndex,
            imageFirstCandidates.length,
            page.pageNumber,
            pages.length,
            responses
          );
          sentDirectConfirmation = sentDirectConfirmation || sentDirect;

          logStep("event.receipt.pdf.page_parsed", {
            mediaIndex,
            pageNumber: page.pageNumber,
            totalPages: pages.length
          });

          if (pageIndex === 0 && page.truncated) {
            const countLabel = page.totalPages ? `${MAX_PDF_PAGES}/${page.totalPages}` : `first ${MAX_PDF_PAGES}`;
            responses.push(`Note: processed ${countLabel} PDF pages only.`);
          }
        }

        continue;
      }

      const messageId = deriveMessageId(baseMessageId, media, mediaIndex, imageFirstCandidates.length, 1, 1);
      const input: ReceiptPipelineInput = {
        chatId,
        messageId,
        receivedAt,
        imageBase64: binary.toString("base64"),
        mimeType
      };

      const sentDirect = await parseAndQueueReceipt(input, telegramChatId, mediaIndex, imageFirstCandidates.length, 1, 1, responses);
      sentDirectConfirmation = sentDirectConfirmation || sentDirect;
      logStep("event.receipt.image_parsed", {
        mediaIndex,
        total: imageFirstCandidates.length,
        messageId
      });
    } catch (error) {
      logStep("event.receipt.error", {
        mediaIndex,
        total: imageFirstCandidates.length,
        error: error instanceof ReceiptError ? `${error.code}:${error.message}` : (error as Error)?.message ?? "unknown_error"
      });
      responses.push(formatFailureMessage(error, mediaIndex, imageFirstCandidates.length));
      logReceiptOutcome({
        receipt_id: `${chatId}:${deriveMessageId(baseMessageId, media, mediaIndex, imageFirstCandidates.length, 1, 1)}`,
        outcome: "error",
        reason:
          error instanceof ReceiptError
            ? `${error.code}:${error.message}`
            : (error as Error)?.message ?? "unknown_error",
        status: getErrorStatus(error),
        metadata: {
          media_url: media.url
        }
      });
    }
  }

  if (responses.length > 0) {
    logStep("event.receipt.output", {
      count: responses.length,
      outputPreview: preview(responses.join("\n\n"))
    });
    await sendControlledText(event, telegramChatId, responses.join("\n\n"));
    return;
  }

  if (sentDirectConfirmation) {
    suppressDownstreamProcessing(event, "receipt_direct_confirmation");
  }
};

export default handler;
