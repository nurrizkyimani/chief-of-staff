import { randomBytes } from "node:crypto";
import {
  buildReceiptPayload,
  persistReceiptPayload,
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
const pendingConfirmations = new Map<string, PendingConfirmation>();

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
  event.messages.push(text);
}

function pickChatId(event: any): string {
  const metadata = event?.context?.metadata ?? {};
  return String(
    metadata.chatId ??
      metadata.conversationId ??
      metadata.channelId ??
      event?.context?.channelId ??
      event?.context?.from?.id ??
      event?.sessionKey ??
      "unknown-chat"
  );
}

function pickTelegramSendChatId(event: any): string | null {
  const metadata = event?.context?.metadata ?? {};
  const from = event?.context?.from ?? {};
  const candidates = [
    metadata.chatId,
    metadata.conversationId,
    metadata.groupId,
    metadata.targetChatId,
    from.chatId,
    from.conversationId,
    from.groupId
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (/^-?\d+$/.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

function pickMessageId(event: any): string {
  const metadata = event?.context?.metadata ?? {};
  return String(
    metadata.messageId ??
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
      candidate.downloadUrl;

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

function formatConfirmationPreview(
  payload: ReceiptPayload,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, pageNumber, totalPages);
  return `${prefix}Parsed receipt (not saved yet):
Merchant: ${payload.merchant_name}
Date: ${payload.receipt_date}
Total: ${payload.total_amount}
Tax: ${payload.tax_amount}
Class: ${payload.classification}
Review: ${payload.needs_review ? "yes" : "no"}

Confirm save to Google Sheets?`;
}

function formatSavedMessage(
  payload: ReceiptPayload,
  appendResult: "appended" | "duplicate",
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, pageNumber, totalPages);

  if (appendResult === "duplicate") {
    return `${prefix}Already recorded (${payload.receipt_id}).`;
  }

  return `${prefix}Saved receipt: ${payload.merchant_name}
Date: ${payload.receipt_date}
Total: ${payload.total_amount}
Tax: ${payload.tax_amount}
Class: ${payload.classification}
Review: ${payload.needs_review ? "yes" : "no"}`;
}

function formatFailureMessage(error: unknown, mediaIndex: number, totalMedia: number): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, 1, 1);

  if (error instanceof ReceiptError) {
    if (error.code === "UNSUPPORTED_MEDIA") {
      return `${prefix}Unsupported file type. Send /receipt with a photo/image.`;
    }
    if (error.code === "PDF_DISABLED") {
      return `${prefix}PDF intake is currently disabled. Send /receipt with a photo/image.`;
    }
    if (error.code === "PDF_CONVERSION") {
      return `${prefix}Could not process PDF. Install poppler-utils (pdftoppm/pdfinfo) on the gateway host.`;
    }
    if (error.code === "MODEL_TEMPORARY") {
      return `${prefix}Temporary parsing error from model provider. Retry in a minute.`;
    }
    if (error.code === "MODEL_PERMANENT") {
      return `${prefix}Could not parse receipt reliably; marked for review.`;
    }
    if (error.code === "SHEETS_READ" || error.code === "SHEETS_WRITE") {
      return `${prefix}Could not save to sheet; check Google Sheets configuration and permissions.`;
    }
    if (error.code === "MEDIA_FETCH") {
      if (error.status === 413) {
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

  try {
    const response = await fetch(`${MISTRAL_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 16,
        messages: [
          {
            role: "user",
            content: "Reply with exactly: OK"
          }
        ]
      })
    });

    const latencyMs = Date.now() - startedAt;
    const bodyText = await response.text();

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
      return {
        ok: false,
        model,
        latencyMs,
        error: "Invalid JSON response from Mistral API."
      };
    }

    const sample = extractMistralContent(payload.choices?.[0]?.message?.content).slice(0, 120) || "(empty)";
    const servedModel = String(payload.model ?? model);

    return {
      ok: true,
      model,
      servedModel,
      latencyMs,
      sample
    };
  } catch (error) {
    return {
      ok: false,
      model,
      latencyMs: Date.now() - startedAt,
      error: (error as Error)?.message ?? "Unknown network error"
    };
  }
}

function formatMistralHealthMessage(result: MistralHealthResult): string {
  if (result.ok) {
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

function parseConfirmationAction(text: string): ConfirmationAction | null {
  const normalized = text.trim();

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
                text: "Confirm",
                callback_data: `${CALLBACK_CONFIRM_PREFIX}${token}`
              },
              {
                text: "Cancel",
                callback_data: `${CALLBACK_REJECT_PREFIX}${token}`
              }
            ]
          ]
        }
      })
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function handleConfirmation(event: any, action: ConfirmationAction): Promise<boolean> {
  prunePendingConfirmations();

  const pending = pendingConfirmations.get(action.token);
  if (!pending) {
    pushMessage(
      event,
      "Receipt confirmation token is missing or expired. Re-send /receipt with the image to parse again."
    );
    return true;
  }

  if (action.decision === "reject") {
    pendingConfirmations.delete(action.token);
    const prefix = prefixLabel(pending.mediaIndex, pending.totalMedia, pending.pageNumber, pending.totalPages);
    pushMessage(event, `${prefix}Cancelled. Receipt was not saved.`);
    return true;
  }

  try {
    const appendResult = await persistReceiptPayload(pending.payload);
    pendingConfirmations.delete(action.token);

    pushMessage(
      event,
      formatSavedMessage(
        pending.payload,
        appendResult,
        pending.mediaIndex,
        pending.totalMedia,
        pending.pageNumber,
        pending.totalPages
      )
    );
  } catch (error) {
    pushMessage(event, formatFailureMessage(error, pending.mediaIndex, pending.totalMedia));
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
): Promise<void> {
  const payload = await buildReceiptPayload(input);
  const token = savePendingConfirmation(payload, mediaIndex, totalMedia, pageNumber, totalPages);
  const previewText = formatConfirmationPreview(payload, mediaIndex, totalMedia, pageNumber, totalPages);

  const sentWithButtons =
    telegramChatId !== null
      ? await sendTelegramInlineConfirmation(telegramChatId, previewText, token)
      : false;
  if (sentWithButtons) {
    const prefix = prefixLabel(mediaIndex, totalMedia, pageNumber, totalPages);
    responses.push(`${prefix}Parsed. Confirm or cancel using the button message.`);
    return;
  }

  responses.push(`${previewText}

Confirm: /receipt_confirm ${token}
Cancel: /receipt_reject ${token}`);
}

const handler = async (event: any) => {
  if (event?.type !== "message" || event?.action !== "preprocessed") return;
  if (!isTelegramEvent(event)) return;

  const text = pickText(event).trim();
  const confirmationAction = parseConfirmationAction(text);
  if (confirmationAction) {
    await handleConfirmation(event, confirmationAction);
    return;
  }

  if (isModelHealthCommand(text)) {
    const health = await checkMistralHealth();
    pushMessage(event, formatMistralHealthMessage(health));
    return;
  }

  if (!isReceiptCommand(text)) return;

  const mediaCandidates = collectMediaCandidates(event, text);
  if (mediaCandidates.length === 0) {
    pushMessage(event, "Send /receipt together with a photo/image.");
    return;
  }

  const chatId = pickChatId(event);
  const telegramChatId = pickTelegramSendChatId(event);
  const baseMessageId = pickMessageId(event);
  const receivedAt = new Date(event?.timestamp ?? Date.now()).toISOString();
  const responses: string[] = [];

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
      const response = await fetch(media.url);
      if (!response.ok) {
        throw new ReceiptError("MEDIA_FETCH", "Could not download media.", {
          status: response.status
        });
      }

      const arrayBuffer = await response.arrayBuffer();
      const binary = Buffer.from(arrayBuffer);
      const mimeType = normalizeMimeType(media.mimeType ?? response.headers.get("content-type") ?? undefined, media.url);

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

          await parseAndQueueReceipt(
            input,
            telegramChatId,
            mediaIndex,
            imageFirstCandidates.length,
            page.pageNumber,
            pages.length,
            responses
          );

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

      await parseAndQueueReceipt(input, telegramChatId, mediaIndex, imageFirstCandidates.length, 1, 1, responses);
    } catch (error) {
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
    pushMessage(event, responses.join("\n\n"));
  }
};

export default handler;
