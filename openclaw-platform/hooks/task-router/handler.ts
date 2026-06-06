import {
  buildTaskRouterContext,
  isPreprocessedMessageEvent,
  logTaskRouterStart
} from "./context.ts";
import { handleReceiptAssistantTask } from "./receipt-assistant-task.ts";
import {
  handleAmbiguousTask,
  handleCaloryAssistantTask,
  handleMissingMediaTask,
  handleModelHealthTask,
  handleReceiptConfirmationTask
} from "./simple-task-handlers.ts";

const handler = async (event: any) => {
  if (!isPreprocessedMessageEvent(event)) return;

  const context = buildTaskRouterContext(event);
  logTaskRouterStart(context);

  switch (context.trigger.kind) {
    case "unhandled":
      return;
    case "ambiguous":
      return handleAmbiguousTask(context);
    case "missing-media":
      return handleMissingMediaTask(context);
    case "calory-assistant":
      return handleCaloryAssistantTask(context);
    case "receipt-confirmation":
      return handleReceiptConfirmationTask(context);
    case "model-health":
      return handleModelHealthTask(context);
    case "receipt-assistant":
      return handleReceiptAssistantTask(context);
  }
};

export default handler;
