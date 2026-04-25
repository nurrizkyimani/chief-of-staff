import { MODEL_HEALTH_COMMAND_PATTERN, RECEIPT_COMMAND_PATTERN } from "./constants.js";

// isReceiptCommand checks whether text asks for receipt intake.
export function isReceiptCommand(text: string): boolean {
  return RECEIPT_COMMAND_PATTERN.test(text);
}

// isModelHealthCommand checks whether text asks for model health.
export function isModelHealthCommand(text: string): boolean {
  return MODEL_HEALTH_COMMAND_PATTERN.test(text);
}
