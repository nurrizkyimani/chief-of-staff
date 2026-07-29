import { env } from "../../config/env.js";
import { formatWealthConfirmationPreview, formatWealthFailureMessage } from "../../domains/wealth/wealth-formatting.js";
import {
  buildWealthSnapshotFromCandidate,
  buildWealthSnapshotFromText
} from "../../domains/wealth/wealth-parser.js";
import { getWealthPlatforms } from "../../domains/wealth/wealth-platform.js";
import { ReceiptError } from "../../errors/receipt_errors.js";
import { deriveMessageId, readMediaCandidate } from "../../integrations/openclaw/media-source.js";
import { extractWealthSnapshotFromImage } from "../../integrations/models/mistral-wealth-parser.adapter.js";
import { rasterizePdfBufferToJpegPages } from "../../media/pdf_rasterizer.js";
import { savePendingWealthConfirmation } from "./wealth-confirmation-store.js";
import type { MediaCandidate } from "../../integrations/openclaw/media-source.js";

export type ProcessWealthAssistantInput = {
  sourcePlatform: string;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
  text: string;
  mediaCandidates: MediaCandidate[];
};

export type WealthConfirmationRequest = {
  token: string;
  previewText: string;
  platform: string;
  platformOptions: string[];
};

export type ProcessWealthAssistantResult = {
  handled: boolean;
  messages: string[];
  confirmations: WealthConfirmationRequest[];
};

export async function processWealthAssistant(
  input: ProcessWealthAssistantInput
): Promise<ProcessWealthAssistantResult> {
  const messages: string[] = [];
  const confirmations: WealthConfirmationRequest[] = [];

  if (input.mediaCandidates.length === 0) {
    try {
      confirmations.push(queueWealthConfirmation(buildWealthSnapshotFromText({
        sourcePlatform: input.sourcePlatform,
        chatId: input.chatId,
        messageId: input.baseMessageId,
        receivedAt: input.receivedAt,
        text: input.text
      })));
    } catch (error) {
      messages.push(formatWealthFailureMessage(error));
    }

    return {
      handled: true,
      messages,
      confirmations
    };
  }

  for (let mediaIndex = 0; mediaIndex < input.mediaCandidates.length; mediaIndex += 1) {
    const media = input.mediaCandidates[mediaIndex];
    try {
      const result = await processWealthMediaCandidate(input, media, mediaIndex, input.mediaCandidates.length);
      confirmations.push(...result.confirmations);
      messages.push(...result.messages);
    } catch (error) {
      messages.push(formatWealthFailureMessage(error));
    }
  }

  return {
    handled: true,
    messages,
    confirmations
  };
}

async function processWealthMediaCandidate(
  input: ProcessWealthAssistantInput,
  media: MediaCandidate,
  mediaIndex: number,
  totalMedia: number
): Promise<{ confirmations: WealthConfirmationRequest[]; messages: string[] }> {
  const { binary, mimeType } = await readMediaCandidate(media);
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");
  if (!isPdf && !isImage) {
    throw new ReceiptError("UNSUPPORTED_MEDIA", `Unsupported wealth media type: ${mimeType}`);
  }
  if (isPdf && (env.RECEIPT_STRICT_MEMORY_ONLY || !env.RECEIPT_ACCEPT_PDF)) {
    throw new ReceiptError("PDF_DISABLED", "PDF parsing is disabled.");
  }

  if (isPdf) {
    const pages = await rasterizePdfBufferToJpegPages(binary, 1);
    const firstPage = pages[0];
    if (!firstPage) {
      throw new ReceiptError("PDF_CONVERSION", "PDF was converted, but no pages were produced.");
    }
    const messageId = deriveMessageId(input.baseMessageId, media, mediaIndex, totalMedia, firstPage.pageNumber, 1);
    const candidate = await extractWealthSnapshotFromImage(
      firstPage.imageBase64,
      firstPage.mimeType,
      input.text || undefined
    );

    return {
      confirmations: [
        queueWealthConfirmation(buildWealthSnapshotFromCandidate({
          sourcePlatform: input.sourcePlatform,
          chatId: input.chatId,
          messageId,
          receivedAt: input.receivedAt,
          candidate,
          captionText: input.text || undefined,
          sourceType: "pdf",
          pdfPageNumber: firstPage.pageNumber,
          pdfTotalPages: firstPage.totalPages,
          pdfTruncated: firstPage.truncated
        }))
      ],
      messages: firstPage.truncated ? ["Note: processed the first PDF page only for this wealth snapshot."] : []
    };
  }

  const messageId = deriveMessageId(input.baseMessageId, media, mediaIndex, totalMedia, 1, 1);
  const candidate = await extractWealthSnapshotFromImage(binary.toString("base64"), mimeType, input.text || undefined);

  return {
    confirmations: [
      queueWealthConfirmation(buildWealthSnapshotFromCandidate({
        sourcePlatform: input.sourcePlatform,
        chatId: input.chatId,
        messageId,
        receivedAt: input.receivedAt,
        candidate,
        captionText: input.text || undefined,
        sourceType: "image"
      }))
    ],
    messages: []
  };
}

function queueWealthConfirmation(payload: ReturnType<typeof buildWealthSnapshotFromText>): WealthConfirmationRequest {
  const token = savePendingWealthConfirmation(payload, env.RECEIPT_CONFIRMATION_TTL_MS);
  return {
    token,
    previewText: formatWealthConfirmationPreview(payload),
    platform: payload.platform,
    platformOptions: getWealthPlatforms()
  };
}
