import type { TaskRouterInput, TaskRouterLogger, TaskRouterResult } from "./task.types.js";
import type { TaskTrigger } from "./task-trigger.detector.js";

export type TaskHandler = {
  name: string;
  canHandle(trigger: TaskTrigger): boolean;
  handle(input: TaskRouterInput, trigger: TaskTrigger, logger?: TaskRouterLogger): Promise<TaskRouterResult>;
};

export function handledTaskResult(input: {
  suppressReason: string;
  messages?: string[];
  confirmations?: TaskRouterResult["confirmations"];
}): TaskRouterResult {
  return {
    handled: true,
    suppressReason: input.suppressReason,
    messages: input.messages ?? [],
    confirmations: input.confirmations ?? []
  };
}

export function unhandledTaskResult(): TaskRouterResult {
  return {
    handled: false,
    messages: [],
    confirmations: []
  };
}
