import {
  type ReceiptPipelineInput
} from "../../dist/pipelines/receipt_pipeline.js";
import { ReceiptError, getErrorStatus } from "../../dist/errors/receipt_errors.js";
import { rasterizePdfBufferToJpegPages } from "../../dist/media/pdf_rasterizer.js";
import { logReceiptOutcome } from "../../dist/observability/receipt_logger.js";
import { MAX_PDF_PAGES } from "./constants.ts";
import { handleConfirmation, parseAndQueueReceipt } from "./confirmation-flow.ts";
import { parseConfirmationAction } from "./confirmations.ts";
import { isModelHealthCommand, isReceiptCommand } from "./commands.ts";
import { errorReason } from "./error.ts";
import {
  pickChatId,
  pickMessageId,
  pickTelegramSendChatId,
  pickText,
  pushMessage,
  isTelegramEvent,
  suppressDownstreamProcessing
} from "./event.ts";
import { formatFailureMessage } from "./formatting.ts";
import { describeMessageShape, logStep, preview } from "./logging.ts";
import {
  collectMediaCandidates,
  deriveMessageId,
  isPdfDisabled,
  normalizeMimeType,
  readMediaCandidate
} from "./media.ts";
import { checkMistralHealth, formatMistralHealthMessage } from "./modelhealth.ts";
import { sendControlledText, sendTelegramTextMessage } from "./telegram.ts";

// handler routes Telegram events through receipt, confirmation, and health flows.
const handler = async (event: any) => {
  // Phase 01: Accept only Telegram preprocessed message events.
  if (event?.type !== "message" || event?.action !== "preprocessed") return;
  if (!isTelegramEvent(event)) return;

  // Phase 02: Log the inbound event shape before routing.
  logStep("event.start", {
    type: event?.type,
    action: event?.action,
    channelId: event?.context?.channelId,
    sessionKey: event?.sessionKey,
    messageShape: Array.isArray(event?.messages) ? describeMessageShape(event.messages) : ["not-array"],
    textPreview: preview(pickText(event))
  });

  // Phase 03: Extract the normalized text and reply target.
  const text = pickText(event).trim();
  const telegramChatId = pickTelegramSendChatId(event);

  // Phase 04: Handle Yes/No confirmation callbacks.
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

  // Phase 05: Handle /modelhealth directly and silence downstream LLM replies.
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

  // Phase 06: Reject unsupported Telegram messages with a controlled response.
  if (!isReceiptCommand(text)) {
    suppressDownstreamProcessing(event, "unsupported_telegram_message");
    await sendControlledText(event, telegramChatId, "Unsupported message. Use /receipt with an image or /modelhealth.");
    return;
  }

  // Phase 07: Collect receipt media and suppress the default assistant path.
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

  // Phase 08: Build stable receipt source metadata for all parsed attachments.
  const chatId = pickChatId(event);
  const baseMessageId = pickMessageId(event);
  const receivedAt = new Date(event?.timestamp ?? Date.now()).toISOString();
  const responses: string[] = [];
  let sentDirectConfirmation = false;

  // Phase 09: Prefer image attachments; skip PDFs when images are present.
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

  // Phase 10: Read each selected media item and queue parsed receipts for confirmation.
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
      if (isPdf && isPdfDisabled()) {
        throw new ReceiptError("PDF_DISABLED", "PDF parsing is disabled in image-first mode.");
      }

      // Phase 10a: Rasterize PDFs page-by-page before parsing.
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

      // Phase 10b: Parse normal image receipts and send the Yes/No preview.
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
        error: errorReason(error)
      });
      responses.push(formatFailureMessage(error, mediaIndex, imageFirstCandidates.length));
      logReceiptOutcome({
        receipt_id: `${chatId}:${deriveMessageId(baseMessageId, media, mediaIndex, imageFirstCandidates.length, 1, 1)}`,
        outcome: "error",
        reason: errorReason(error),
        status: getErrorStatus(error),
        metadata: {
          media_url: media.url
        }
      });
    }
  }

  // Phase 11: Send fallback text responses when inline Telegram delivery was unavailable.
  if (responses.length > 0) {
    logStep("event.receipt.output", {
      count: responses.length,
      outputPreview: preview(responses.join("\n\n"))
    });
    await sendControlledText(event, telegramChatId, responses.join("\n\n"));
    return;
  }

  // Phase 12: Final suppression guard when preview was sent directly with buttons.
  if (sentDirectConfirmation) {
    suppressDownstreamProcessing(event, "receipt_direct_confirmation");
  }
};

export default handler;
