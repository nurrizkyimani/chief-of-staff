import {
  executeReceiptAssistant,
  type ReceiptAssistantExecutorLogger
} from "../../dist/executors/receipt-assistant/receipt-assistant.executor.js";
import type { ReceiptConfirmationRequest } from "../../dist/usecases/receipt-assistant/queue-receipt-confirmation.js";
import { logStep, preview } from "./logging.ts";
import { suppressDownstreamProcessing } from "./openclaw-event.ts";
import { sendControlledText, sendTelegramInlineConfirmation } from "./telegram.ts";
import type { TaskRouterContext } from "./types.ts";

export async function handleReceiptAssistantTask(context: TaskRouterContext): Promise<void> {
  if (context.trigger.kind !== "receipt-assistant") return;

  const responses: string[] = [];
  let sentDirectConfirmation = false;

  suppressDownstreamProcessing(context.event, context.trigger.source);

  const result = await executeReceiptAssistant(
    {
      sourcePlatform: context.sourcePlatform,
      chatId: context.chatId,
      baseMessageId: context.baseMessageId,
      receivedAt: context.receivedAt,
      captionText: context.text || undefined,
      mediaCandidates: context.mediaCandidates,
      intent: context.trigger.intent,
      intentSource: context.trigger.source
    },
    receiptTaskLogger
  );

  responses.push(...result.messages);

  for (const confirmation of result.confirmations) {
    const sentDirect = await presentReceiptConfirmation(context, confirmation);
    sentDirectConfirmation = sentDirectConfirmation || sentDirect;
    if (!sentDirect) {
      responses.push(formatReceiptConfirmationFallback(confirmation));
    }
  }

  if (responses.length > 0) {
    await sendControlledText(context.event, context.telegramChatId, responses.join("\n\n"));
    return;
  }

  if (sentDirectConfirmation) {
    suppressDownstreamProcessing(context.event, "receipt_direct_confirmation");
  }
}

async function presentReceiptConfirmation(
  context: TaskRouterContext,
  confirmation: ReceiptConfirmationRequest
): Promise<boolean> {
  if (context.telegramChatId === null) return false;
  return sendTelegramInlineConfirmation(context.telegramChatId, confirmation.previewText, confirmation.token);
}

function formatReceiptConfirmationFallback(confirmation: ReceiptConfirmationRequest): string {
  return `${confirmation.previewText}

Confirm: /receipt_confirm ${confirmation.token}
Cancel: /receipt_reject ${confirmation.token}`;
}

const receiptTaskLogger: ReceiptAssistantExecutorLogger = {
  receiptMediaCandidates(input) {
    logStep("task_router.receipt.media_candidates", {
      intent: input.intent,
      intentSource: input.intentSource,
      count: input.count,
      candidates: input.candidates.map((candidate) => ({
        url: preview(candidate.url, 120),
        mimeType: candidate.mimeType ?? "(none)",
        sourceId: candidate.sourceId ?? "(none)"
      }))
    });
  },
  receiptMediaFetched(input) {
    logStep("task_router.receipt.fetch.ok", {
      mediaIndex: input.mediaIndex,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      resolvedFrom: preview(input.resolvedFrom, 160)
    });
  },
  receiptMediaError(input) {
    logStep("task_router.receipt.error", input);
  }
};
