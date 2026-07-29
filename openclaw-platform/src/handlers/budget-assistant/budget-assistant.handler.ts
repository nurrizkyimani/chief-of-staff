import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";
import { processBudgetAssistant } from "../../usecases/budget-assistant/process-budget-assistant.js";

export const budgetAssistantHandler: TaskHandler = {
  name: "budget-assistant",
  canHandle(trigger) {
    return trigger.kind === "budget-assistant";
  },
  async handle(_input, trigger, logger) {
    if (trigger.kind !== "budget-assistant") {
      return handledTaskResult({ suppressReason: "budget_assistant_unmatched" });
    }

    const result = await processBudgetAssistant();
    logger?.log("task_router.budget.status", {
      messages: result.messages.length
    });

    return handledTaskResult({
      suppressReason: trigger.source,
      messages: result.messages
    });
  }
};
