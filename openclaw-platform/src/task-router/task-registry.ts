import { caloryAssistantHandler } from "../handlers/calory-assistant/calory-assistant.handler.js";
import {
  cicilanAssistantHandler,
  cicilanConfirmationHandler
} from "../handlers/cicilan-assistant/cicilan-assistant.handler.js";
import {
  receiptAssistantHandler,
  receiptConfirmationHandler
} from "../handlers/receipt-assistant/receipt-assistant.handler.js";
import { modelHealthHandler } from "../handlers/model-health/model-health.handler.js";
import { wishlistAssistantHandler } from "../handlers/wishlist-assistant/wishlist-assistant.handler.js";
import type { TaskHandler } from "./task-handler.js";

export const taskRegistry: TaskHandler[] = [
  cicilanAssistantHandler,
  cicilanConfirmationHandler,
  receiptAssistantHandler,
  receiptConfirmationHandler,
  wishlistAssistantHandler,
  caloryAssistantHandler,
  modelHealthHandler
];
