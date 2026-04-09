import { runReceiptPipeline, type ReceiptPipelineResult } from "../../dist/pipelines/receipt_pipeline.js";
import { ReceiptError, getErrorStatus } from "../../dist/errors/receipt_errors.js";
import { rasterizePdfBufferToJpegPages } from "../../dist/media/pdf_rasterizer.js";
import { logReceiptOutcome } from "../../dist/observability/receipt_logger.js";
import { env } from "../../dist/config/env.js";

type MediaCandidate = {
  url: string;
  mimeType?: string;
  sourceId?: string;
};

const MAX_PDF_PAGES = env.RECEIPT_MAX_PDF_PAGES;

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
      metadata.channelId ??
      event?.context?.channelId ??
      event?.context?.from?.id ??
      event?.sessionKey ??
      "unknown-chat"
  );
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

function formatSuccessMessage(
  result: ReceiptPipelineResult,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  const prefix = prefixLabel(mediaIndex, totalMedia, pageNumber, totalPages);
  const payload = result.payload;

  if (result.appendResult === "duplicate") {
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
      return `${prefix}Unsupported file type. Send /receipt with a photo or PDF.`;
    }
    if (error.code === "PDF_DISABLED") {
      return `${prefix}PDF is disabled in strict in-memory mode. Send /receipt with a photo/image.`;
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

const handler = async (event: any) => {
  if (event?.type !== "message" || event?.action !== "preprocessed") return;
  if (!isTelegramEvent(event)) return;

  const text = pickText(event);
  if (!text.includes("/receipt")) return;

  const mediaCandidates = collectMediaCandidates(event, text);
  if (mediaCandidates.length === 0) {
    pushMessage(event, "Send /receipt together with a photo or PDF.");
    return;
  }

  const chatId = pickChatId(event);
  const baseMessageId = pickMessageId(event);
  const receivedAt = new Date(event?.timestamp ?? Date.now()).toISOString();
  const responses: string[] = [];

  for (let mediaIndex = 0; mediaIndex < mediaCandidates.length; mediaIndex += 1) {
    const media = mediaCandidates[mediaIndex];

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
      if (isPdf && env.RECEIPT_STRICT_MEMORY_ONLY) {
        throw new ReceiptError(
          "PDF_DISABLED",
          "PDF parsing is disabled in strict in-memory mode."
        );
      }

      if (isPdf) {
        const pages = await rasterizePdfBufferToJpegPages(binary, MAX_PDF_PAGES);
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const page = pages[pageIndex];
          const messageId = deriveMessageId(
            baseMessageId,
            media,
            mediaIndex,
            mediaCandidates.length,
            page.pageNumber,
            pages.length
          );

          const result = await runReceiptPipeline({
            chatId,
            messageId,
            receivedAt,
            imageBase64: page.imageBase64,
            mimeType: page.mimeType
          });

          let message = formatSuccessMessage(result, mediaIndex, mediaCandidates.length, page.pageNumber, pages.length);
          if (pageIndex === 0 && page.truncated) {
            const countLabel = page.totalPages ? `${MAX_PDF_PAGES}/${page.totalPages}` : `first ${MAX_PDF_PAGES}`;
            message += `\nNote: processed ${countLabel} PDF pages only.`;
          }
          responses.push(message);
        }

        continue;
      }

      const messageId = deriveMessageId(baseMessageId, media, mediaIndex, mediaCandidates.length, 1, 1);
      const result = await runReceiptPipeline({
        chatId,
        messageId,
        receivedAt,
        imageBase64: binary.toString("base64"),
        mimeType
      });
      responses.push(formatSuccessMessage(result, mediaIndex, mediaCandidates.length, 1, 1));
    } catch (error) {
      responses.push(formatFailureMessage(error, mediaIndex, mediaCandidates.length));
      logReceiptOutcome({
        receipt_id: `${chatId}:${deriveMessageId(baseMessageId, media, mediaIndex, mediaCandidates.length, 1, 1)}`,
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
