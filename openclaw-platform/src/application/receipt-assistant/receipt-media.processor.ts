import { env } from "../../config/env.js";
import { ReceiptError } from "../../errors/receipt_errors.js";
import {
  deriveMessageId,
  readMediaCandidate,
  type MediaCandidate
} from "../../integrations/openclaw/media-source.js";
import { rasterizePdfBufferToJpegPages } from "../../media/pdf_rasterizer.js";
import {
  parseAndQueueReceiptConfirmation,
  type ReceiptConfirmationRequest
} from "../../usecases/receipt-assistant/queue-receipt-confirmation.js";
import type { ProcessReceiptAssistantInput } from "./process-receipt-assistant.types.js";

export type ReceiptMediaProcessorLogger = {
  receiptMediaFetched(input: {
    mediaIndex: number;
    sizeBytes: number;
    mimeType: string;
    resolvedFrom: string;
  }): void;
};

export type ReceiptMediaProcessParams = {
  input: ProcessReceiptAssistantInput;
  media: MediaCandidate;
  mediaIndex: number;
  totalMedia: number;
  logger?: ReceiptMediaProcessorLogger;
};

export type ReceiptMediaProcessResult = {
  confirmations: ReceiptConfirmationRequest[];
  messages: string[];
};

export async function processReceiptMediaCandidate(
  params: ReceiptMediaProcessParams
): Promise<ReceiptMediaProcessResult> {
  const { input, media, mediaIndex, totalMedia, logger } = params;
  const { binary, mimeType, resolvedFrom } = await readMediaCandidate(media);

  logger?.receiptMediaFetched({
    mediaIndex,
    sizeBytes: binary.byteLength,
    mimeType,
    resolvedFrom
  });

  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");
  if (!isPdf && !isImage) {
    throw new ReceiptError("UNSUPPORTED_MEDIA", `Unsupported media type: ${mimeType}`);
  }
  if (isPdf && isPdfDisabled()) {
    throw new ReceiptError("PDF_DISABLED", "PDF parsing is disabled in image-first mode.");
  }

  if (isPdf) {
    return processReceiptPdf({ input, media, mediaIndex, totalMedia, binary });
  }

  const messageId = deriveMessageId(input.baseMessageId, media, mediaIndex, totalMedia, 1, 1);
  const confirmation = await parseAndQueueReceiptConfirmation(
    {
      sourcePlatform: input.sourcePlatform,
      chatId: input.chatId,
      messageId,
      receivedAt: input.receivedAt,
      imageBase64: binary.toString("base64"),
      mimeType,
      intent: input.intent,
      intentSource: input.intentSource,
      captionText: input.captionText
    },
    mediaIndex,
    totalMedia,
    1,
    1
  );

  return {
    confirmations: [confirmation],
    messages: []
  };
}

async function processReceiptPdf(
  params: ReceiptMediaProcessParams & { binary: Buffer }
): Promise<ReceiptMediaProcessResult> {
  const { input, media, mediaIndex, totalMedia, binary } = params;
  const pages = await rasterizePdfBufferToJpegPages(binary, env.RECEIPT_MAX_PDF_PAGES);
  const confirmations: ReceiptConfirmationRequest[] = [];
  const messages: string[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const messageId = deriveMessageId(
      input.baseMessageId,
      media,
      mediaIndex,
      totalMedia,
      page.pageNumber,
      pages.length
    );

    confirmations.push(
      await parseAndQueueReceiptConfirmation(
        {
          sourcePlatform: input.sourcePlatform,
          chatId: input.chatId,
          messageId,
          receivedAt: input.receivedAt,
          imageBase64: page.imageBase64,
          mimeType: page.mimeType,
          intent: input.intent,
          intentSource: input.intentSource,
          captionText: input.captionText
        },
        mediaIndex,
        totalMedia,
        page.pageNumber,
        pages.length
      )
    );

    if (pageIndex === 0 && page.truncated) {
      const countLabel = page.totalPages
        ? `${env.RECEIPT_MAX_PDF_PAGES}/${page.totalPages}`
        : `first ${env.RECEIPT_MAX_PDF_PAGES}`;
      messages.push(`Note: processed ${countLabel} PDF pages only.`);
    }
  }

  return {
    confirmations,
    messages
  };
}

export function isPdfDisabled(): boolean {
  return env.RECEIPT_STRICT_MEMORY_ONLY || !env.RECEIPT_ACCEPT_PDF;
}
