import { caloryAssistantHandler } from "../handlers/calory-assistant/calory-assistant.handler.js";
import { budgetAssistantHandler } from "../handlers/budget-assistant/budget-assistant.handler.js";
import {
  cicilanAssistantHandler,
  cicilanConfirmationHandler
} from "../handlers/cicilan-assistant/cicilan-assistant.handler.js";
import {
  receiptAssistantHandler,
  receiptConfirmationHandler
} from "../handlers/receipt-assistant/receipt-assistant.handler.js";
import { modelHealthHandler } from "../handlers/model-health/model-health.handler.js";
import { financeDigestHandler } from "../handlers/finance-digest/finance-digest.handler.js";
import {
  wealthAssistantHandler,
  wealthConfirmationHandler
} from "../handlers/wealth-assistant/wealth-assistant.handler.js";
import { wishlistAssistantHandler } from "../handlers/wishlist-assistant/wishlist-assistant.handler.js";
import { gmailReceiptImportHandler } from "../handlers/gmail-receipt-import/gmail-receipt-import.handler.js";
import type { TaskHandler } from "./task-handler.js";

export const taskRegistry: TaskHandler[] = [
  budgetAssistantHandler,
  wealthAssistantHandler,
  wealthConfirmationHandler,
  cicilanAssistantHandler,
  cicilanConfirmationHandler,
  receiptAssistantHandler,
  receiptConfirmationHandler,
  gmailReceiptImportHandler,
  wishlistAssistantHandler,
  caloryAssistantHandler,
  modelHealthHandler,
  financeDigestHandler
];
