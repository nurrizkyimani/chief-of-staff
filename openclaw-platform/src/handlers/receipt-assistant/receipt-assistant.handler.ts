import {
  processReceiptAssistant,
  type ProcessReceiptAssistantLogger
} from "../../application/receipt-assistant/process-receipt-assistant.js";
import { handleReceiptConfirmation } from "../../usecases/receipt-assistant/handle-receipt-confirmation.js";
import {
  CALLBACK_CONFIRM_PREFIX,
  CALLBACK_REJECT_PREFIX,
  parseConfirmationAction
} from "../../usecases/receipt-assistant/receipt-confirmation-store.js";
import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";
import type { TaskRouterInput, TaskRouterLogger } from "../../task-router/task.types.js";
import type { TaskTrigger } from "../../task-router/task-trigger.detector.js";

export const receiptAssistantHandler: TaskHandler = {
  name: "receipt-assistant",
  canHandle(trigger) {
    return trigger.kind === "receipt-assistant";
  },
  async handle(input, trigger, logger) {
    if (trigger.kind !== "receipt-assistant") {
      return handledTaskResult({ suppressReason: "receipt_assistant_unmatched" });
    }

    const result = await processReceiptAssistant(
      {
        sourcePlatform: input.sourcePlatform,
        chatId: input.chatId,
        baseMessageId: input.baseMessageId,
        receivedAt: input.receivedAt,
        captionText: input.text || undefined,
        mediaCandidates: input.mediaCandidates,
        intent: trigger.intent,
        intentSource: trigger.source
      },
      createReceiptApplicationLogger(logger)
    );

    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.messages,
      confirmations: result.confirmations.map((confirmation) => ({
        token: confirmation.token,
        previewText: confirmation.previewText,
        confirmCommand: `/receipt_confirm ${confirmation.token}`,
        rejectCommand: `/receipt_reject ${confirmation.token}`,
        confirmCallbackData: `${CALLBACK_CONFIRM_PREFIX}${confirmation.token}`,
        rejectCallbackData: `${CALLBACK_REJECT_PREFIX}${confirmation.token}`
      }))
    });
  }
};

export const receiptConfirmationHandler: TaskHandler = {
  name: "receipt-confirmation",
  canHandle(trigger) {
    return trigger.kind === "receipt-confirmation";
  },
  async handle(input, trigger, logger) {
    if (trigger.kind !== "receipt-confirmation") {
      return handledTaskResult({ suppressReason: "receipt_confirmation_unmatched" });
    }

    const confirmationAction = parseConfirmationAction(input.text);
    if (!confirmationAction) {
      return handledTaskResult({ suppressReason: trigger.source });
    }

    logger?.log("task_router.receipt.confirmation", {
      decision: confirmationAction.decision,
      token: confirmationAction.token
    });

    const result = await handleReceiptConfirmation(confirmationAction);
    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.message ? [result.message] : []
    });
  }
};

function createReceiptApplicationLogger(logger?: TaskRouterLogger): ProcessReceiptAssistantLogger | undefined {
  if (!logger) return undefined;

  return {
    receiptMediaCandidates(input) {
      logger.log("task_router.receipt.media_candidates", {
        intent: input.intent,
        intentSource: input.intentSource,
        count: input.count,
        candidates: input.candidates
      });
    },
    receiptMediaFetched(input) {
      logger.log("task_router.receipt.fetch.ok", {
        mediaIndex: input.mediaIndex,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        resolvedFrom: input.resolvedFrom
      });
    },
    receiptMediaError(input) {
      logger.log("task_router.receipt.error", input);
    }
  };
}
