import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";
import { processWishlistAssistant } from "../../usecases/wishlist-assistant/process-wishlist-assistant.js";

export const wishlistAssistantHandler: TaskHandler = {
  name: "wishlist-assistant",
  canHandle(trigger) {
    return trigger.kind === "wishlist-assistant";
  },
  async handle(input, trigger) {
    if (trigger.kind !== "wishlist-assistant") {
      return handledTaskResult({ suppressReason: "wishlist_unmatched" });
    }

    const result = await processWishlistAssistant({
      text: input.text,
      sourcePlatform: input.sourcePlatform,
      chatId: input.chatId
    });

    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.messages
    });
  }
};
