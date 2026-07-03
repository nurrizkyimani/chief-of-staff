import { getReceiptPaymentMethods } from "../../domains/receipts/receipt-payment-method.js";
import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";
import type { TaskRouterLogger } from "../../task-router/task.types.js";
import { handleCicilanConfirmation } from "../../usecases/cicilan-assistant/handle-cicilan-confirmation.js";
import { processCicilanAssistant } from "../../usecases/cicilan-assistant/process-cicilan-assistant.js";
import {
  CICILAN_CALLBACK_CONFIRM_PREFIX,
  CICILAN_CALLBACK_METHOD_PREFIX,
  CICILAN_CALLBACK_REJECT_PREFIX,
  parseCicilanConfirmationAction
} from "../../usecases/cicilan-assistant/cicilan-confirmation-store.js";

export const cicilanAssistantHandler: TaskHandler = {
  name: "cicilan-assistant",
  canHandle(trigger) {
    return trigger.kind === "cicilan-assistant";
  },
  async handle(input, trigger, logger) {
    if (trigger.kind !== "cicilan-assistant") {
      return handledTaskResult({ suppressReason: "cicilan_assistant_unmatched" });
    }

    const result = await processCicilanAssistant({
      sourcePlatform: input.sourcePlatform,
      chatId: input.chatId,
      baseMessageId: input.baseMessageId,
      receivedAt: input.receivedAt,
      text: input.text
    });

    logger?.log("task_router.cicilan.parse", {
      confirmations: result.confirmations.length,
      messages: result.messages.length
    });

    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.messages,
      confirmations: result.confirmations.map((confirmation) => ({
        token: confirmation.token,
        previewText: confirmation.previewText,
        paymentMethod: confirmation.paymentMethod,
        paymentMethodOptions: confirmation.paymentMethodOptions,
        confirmCommand: `/cicilan_confirm ${confirmation.token}`,
        rejectCommand: `/cicilan_reject ${confirmation.token}`,
        methodCommands: getReceiptPaymentMethods().map((paymentMethod) => ({
          paymentMethod,
          command: `/cicilan_method ${confirmation.token} ${paymentMethod}`,
          callbackData: `${CICILAN_CALLBACK_METHOD_PREFIX}${confirmation.token}:${paymentMethod}`
        })),
        confirmCallbackData: `${CICILAN_CALLBACK_CONFIRM_PREFIX}${confirmation.token}`,
        rejectCallbackData: `${CICILAN_CALLBACK_REJECT_PREFIX}${confirmation.token}`
      }))
    });
  }
};

export const cicilanConfirmationHandler: TaskHandler = {
  name: "cicilan-confirmation",
  canHandle(trigger) {
    return trigger.kind === "cicilan-confirmation";
  },
  async handle(input, trigger, logger) {
    if (trigger.kind !== "cicilan-confirmation") {
      return handledTaskResult({ suppressReason: "cicilan_confirmation_unmatched" });
    }

    const action = parseCicilanConfirmationAction(input.text);
    if (!action) {
      return handledTaskResult({ suppressReason: trigger.source });
    }

    logger?.log("task_router.cicilan.confirmation", {
      decision: action.decision,
      token: action.token,
      ...(action.decision === "method" ? { paymentMethod: action.paymentMethod } : {})
    });

    const result = await handleCicilanConfirmation(action);
    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.message ? [result.message] : []
    });
  }
};
