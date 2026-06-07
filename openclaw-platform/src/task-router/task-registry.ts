import { caloryAssistantHandler } from "../handlers/calory-assistant/calory-assistant.handler.js";
import {
  receiptAssistantHandler,
  receiptConfirmationHandler
} from "../handlers/receipt-assistant/receipt-assistant.handler.js";
import { modelHealthHandler } from "../handlers/model-health/model-health.handler.js";
import type { TaskHandler } from "./task-handler.js";

export const taskRegistry: TaskHandler[] = [
  receiptAssistantHandler,
  receiptConfirmationHandler,
  caloryAssistantHandler,
  modelHealthHandler
];
