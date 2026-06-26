import {
  checkReceiptModelHealth,
  formatReceiptModelHealthMessage,
  type ModelHealthLogger
} from "../../usecases/model-health/check-mistral-health.js";
import type { TaskHandler } from "../../task-router/task-handler.js";
import { handledTaskResult } from "../../task-router/task-handler.js";
import type { TaskRouterLogger } from "../../task-router/task.types.js";

export const modelHealthHandler: TaskHandler = {
  name: "model-health",
  canHandle(trigger) {
    return trigger.kind === "model-health";
  },
  async handle(_input, trigger, logger) {
    if (trigger.kind !== "model-health") {
      return handledTaskResult({ suppressReason: "model_health_unmatched" });
    }

    const health = await checkReceiptModelHealth(createModelHealthLogger(logger));
    return handledTaskResult({
      suppressReason: trigger.source,
      messages: [formatReceiptModelHealthMessage(health)]
    });
  }
};

function createModelHealthLogger(logger?: TaskRouterLogger): ModelHealthLogger | undefined {
  if (!logger) return undefined;

  return {
    request(input) {
      logger.log("modelhealth.request", input);
    },
    response(input) {
      logger.log("modelhealth.response", input);
    },
    invalidJson(input) {
      logger.log("modelhealth.parse.invalid_json", input);
    },
    parseOk(input) {
      logger.log("modelhealth.parse.ok", input);
    },
    requestError(input) {
      logger.log("modelhealth.request.error", input);
    }
  };
}
