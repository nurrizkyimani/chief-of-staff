import { getWealthPlatforms } from "../../domains/wealth/wealth-platform.js";
import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";
import { handleWealthConfirmation } from "../../usecases/wealth-assistant/handle-wealth-confirmation.js";
import { processWealthAssistant } from "../../usecases/wealth-assistant/process-wealth-assistant.js";
import {
  WEALTH_CALLBACK_CONFIRM_PREFIX,
  WEALTH_CALLBACK_PLATFORM_PREFIX,
  WEALTH_CALLBACK_REJECT_PREFIX,
  parseWealthConfirmationAction
} from "../../usecases/wealth-assistant/wealth-confirmation-store.js";

export const wealthAssistantHandler: TaskHandler = {
  name: "wealth-assistant",
  canHandle(trigger) {
    return trigger.kind === "wealth-assistant";
  },
  async handle(input, trigger, logger) {
    if (trigger.kind !== "wealth-assistant") {
      return handledTaskResult({ suppressReason: "wealth_assistant_unmatched" });
    }

    const result = await processWealthAssistant({
      sourcePlatform: input.sourcePlatform,
      chatId: input.chatId,
      baseMessageId: input.baseMessageId,
      receivedAt: input.receivedAt,
      text: input.text,
      mediaCandidates: input.mediaCandidates
    });

    logger?.log("task_router.wealth.parse", {
      confirmations: result.confirmations.length,
      messages: result.messages.length
    });

    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.messages,
      confirmations: result.confirmations.map((confirmation) => ({
        token: confirmation.token,
        previewText: confirmation.previewText,
        paymentMethod: confirmation.platform,
        paymentMethodOptions: confirmation.platformOptions,
        optionLabel: "platform",
        confirmCommand: `/wealth_confirm ${confirmation.token}`,
        rejectCommand: `/wealth_reject ${confirmation.token}`,
        methodCommands: getWealthPlatforms().map((platform) => ({
          paymentMethod: platform,
          command: `/wealth_platform ${confirmation.token} ${platform}`,
          callbackData: `${WEALTH_CALLBACK_PLATFORM_PREFIX}${confirmation.token}:${platform}`
        })),
        confirmCallbackData: `${WEALTH_CALLBACK_CONFIRM_PREFIX}${confirmation.token}`,
        rejectCallbackData: `${WEALTH_CALLBACK_REJECT_PREFIX}${confirmation.token}`
      }))
    });
  }
};

export const wealthConfirmationHandler: TaskHandler = {
  name: "wealth-confirmation",
  canHandle(trigger) {
    return trigger.kind === "wealth-confirmation";
  },
  async handle(input, trigger, logger) {
    if (trigger.kind !== "wealth-confirmation") {
      return handledTaskResult({ suppressReason: "wealth_confirmation_unmatched" });
    }

    const action = parseWealthConfirmationAction(input.text);
    if (!action) {
      return handledTaskResult({ suppressReason: trigger.source });
    }

    logger?.log("task_router.wealth.confirmation", {
      decision: action.decision,
      token: action.token,
      ...(action.decision === "platform" ? { platform: action.platform } : {})
    });

    const result = await handleWealthConfirmation(action);
    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.message ? [result.message] : []
    });
  }
};
