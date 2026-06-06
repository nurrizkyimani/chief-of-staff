import {
  checkMistralHealth,
  formatMistralHealthMessage,
  type ModelHealthLogger
} from "../../dist/usecases/model-health/check-mistral-health.js";
import { executeCaloryAssistant } from "../../dist/executors/calory-assistant/calory-assistant.executor.js";
import { handleReceiptConfirmation } from "../../dist/usecases/receipt-assistant/handle-receipt-confirmation.js";
import { parseConfirmationAction } from "../../dist/usecases/receipt-assistant/receipt-confirmation-store.js";
import { logStep, preview } from "./logging.ts";
import { pushMessage, suppressDownstreamProcessing } from "./openclaw-event.ts";
import { sendControlledText, sendTelegramTextMessage } from "./telegram.ts";
import type { TaskRouterContext } from "./types.ts";

export async function handleAmbiguousTask(context: TaskRouterContext): Promise<void> {
  if (context.trigger.kind !== "ambiguous") return;

  suppressDownstreamProcessing(context.event, "task_ambiguous");
  await sendControlledText(context.event, context.telegramChatId, context.trigger.reason);
}

export async function handleMissingMediaTask(context: TaskRouterContext): Promise<void> {
  if (context.trigger.kind !== "missing-media") return;

  suppressDownstreamProcessing(context.event, `${context.trigger.task}_missing_media`);
  await sendControlledText(
    context.event,
    context.telegramChatId,
    `Upload media with /${context.trigger.label}.`
  );
}

export async function handleCaloryAssistantTask(context: TaskRouterContext): Promise<void> {
  suppressDownstreamProcessing(context.event, "calory_assistant_not_implemented");
  const result = await executeCaloryAssistant({
    sourcePlatform: context.sourcePlatform,
    chatId: context.chatId,
    baseMessageId: context.baseMessageId,
    receivedAt: context.receivedAt,
    text: context.text,
    mediaCount: context.mediaCandidates.length
  });
  await sendControlledText(
    context.event,
    context.telegramChatId,
    result.messages.join("\n\n")
  );
}

export async function handleReceiptConfirmationTask(context: TaskRouterContext): Promise<void> {
  if (context.trigger.kind !== "receipt-confirmation") return;

  const confirmationAction = parseConfirmationAction(context.text);
  if (!confirmationAction) return;

  logStep("task_router.receipt.confirmation", {
    decision: confirmationAction.decision,
    token: confirmationAction.token
  });
  suppressDownstreamProcessing(context.event, context.trigger.source);
  const result = await handleReceiptConfirmation(confirmationAction);
  if (result.message) {
    await sendControlledText(context.event, context.telegramChatId, result.message);
  }
}

export async function handleModelHealthTask(context: TaskRouterContext): Promise<void> {
  if (context.trigger.kind !== "model-health") return;

  suppressDownstreamProcessing(context.event, context.trigger.source);
  const health = await checkMistralHealth(modelHealthLogger);
  const healthMessage = formatMistralHealthMessage(health);
  const sentDirect =
    context.telegramChatId !== null
      ? await sendTelegramTextMessage(context.telegramChatId, healthMessage)
      : false;

  if (!sentDirect) {
    pushMessage(context.event, healthMessage);
  }
}

const modelHealthLogger: ModelHealthLogger = {
  request(input) {
    logStep("modelhealth.request", input);
  },
  response(input) {
    logStep("modelhealth.response", input);
  },
  invalidJson(input) {
    logStep("modelhealth.parse.invalid_json", input);
  },
  parseOk(input) {
    logStep("modelhealth.parse.ok", input);
  },
  requestError(input) {
    logStep("modelhealth.request.error", {
      error: preview(input.error)
    });
  }
};
