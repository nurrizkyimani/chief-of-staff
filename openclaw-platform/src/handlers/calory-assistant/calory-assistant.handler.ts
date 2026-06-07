import { processCaloryAssistant } from "../../application/calory-assistant/process-calory-assistant.js";
import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";

export const caloryAssistantHandler: TaskHandler = {
  name: "calory-assistant",
  canHandle(trigger) {
    return trigger.kind === "calory-assistant";
  },
  async handle(input, trigger) {
    if (trigger.kind !== "calory-assistant") {
      return handledTaskResult({ suppressReason: "calory_assistant_unmatched" });
    }

    const result = await processCaloryAssistant({
      sourcePlatform: input.sourcePlatform,
      chatId: input.chatId,
      baseMessageId: input.baseMessageId,
      receivedAt: input.receivedAt,
      text: input.text,
      mediaCount: input.mediaCandidates.length
    });

    return handledTaskResult({
      suppressReason: "calory_assistant_not_implemented",
      messages: result.messages
    });
  }
};
