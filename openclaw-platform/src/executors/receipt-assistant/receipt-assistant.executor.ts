import { formatReceiptFailureMessage } from "../../domains/receipts/receipt-formatting.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import { deriveMessageId, type MediaCandidate } from "../../integrations/openclaw/media-source.js";
import { logReceiptOutcome } from "../../observability/receipt_logger.js";
import { processReceiptMediaCandidate } from "./receipt-media.processor.js";
import { selectReceiptMediaCandidates } from "./receipt-media-selection.js";
import type { ReceiptAssistantExecutorInput, ReceiptAssistantExecutorResult } from "./receipt-assistant.types.js";

export type ReceiptAssistantExecutorLogger = {
  receiptMediaCandidates(input: {
    intent: string;
    intentSource: string;
    count: number;
    candidates: MediaCandidate[];
  }): void;
  receiptMediaFetched(input: {
    mediaIndex: number;
    sizeBytes: number;
    mimeType: string;
    resolvedFrom: string;
  }): void;
  receiptMediaError(input: {
    mediaIndex: number;
    total: number;
    error: string;
  }): void;
};

export async function executeReceiptAssistant(
  input: ReceiptAssistantExecutorInput,
  logger?: ReceiptAssistantExecutorLogger
): Promise<ReceiptAssistantExecutorResult> {
  const messages: string[] = [];
  const confirmations: ReceiptAssistantExecutorResult["confirmations"] = [];
  const mediaSelection = selectReceiptMediaCandidates(input.mediaCandidates);

  logger?.receiptMediaCandidates({
    intent: input.intent,
    intentSource: input.intentSource,
    count: input.mediaCandidates.length,
    candidates: input.mediaCandidates
  });

  if (mediaSelection.skippedPdfCount > 0) {
    messages.push(`Ignored ${mediaSelection.skippedPdfCount} PDF attachment(s). Image-first mode is active.`);
  }

  for (let mediaIndex = 0; mediaIndex < mediaSelection.candidates.length; mediaIndex += 1) {
    const media = mediaSelection.candidates[mediaIndex];

    try {
      const result = await processReceiptMediaCandidate({
        input,
        media,
        mediaIndex,
        totalMedia: mediaSelection.candidates.length,
        logger
      });
      confirmations.push(...result.confirmations);
      messages.push(...result.messages);
    } catch (error) {
      logger?.receiptMediaError({
        mediaIndex,
        total: mediaSelection.candidates.length,
        error: errorReason(error)
      });
      messages.push(formatReceiptFailureMessage(error, mediaIndex, mediaSelection.candidates.length));
      logReceiptOutcome({
        receipt_id: `${input.chatId}:${deriveMessageId(
          input.baseMessageId,
          media,
          mediaIndex,
          mediaSelection.candidates.length,
          1,
          1
        )}`,
        outcome: "error",
        reason: errorReason(error),
        status: getErrorStatus(error),
        metadata: {
          media_url: media.url
        }
      });
    }
  }

  return {
    handled: true,
    messages,
    confirmations
  };
}

function errorReason(error: unknown): string {
  if (error instanceof ReceiptError) {
    return error.code;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
