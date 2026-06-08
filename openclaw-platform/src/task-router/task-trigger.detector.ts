export type TaskTrigger =
  | {
      kind: "receipt-assistant";
      intent: "receipt" | "income";
      source: "receipt_command" | "income_command";
    }
  | {
      kind: "calory-assistant";
      source: "gym_command";
    }
  | {
      kind: "receipt-confirmation";
      source: "receipt_confirmation";
    }
  | {
      kind: "model-health";
      source: "modelhealth_command";
    }
  | {
      kind: "ambiguous";
      reason: string;
    }
  | {
      kind: "missing-media";
      task: "receipt-assistant" | "calory-assistant";
      label: string;
    }
  | {
      kind: "unhandled";
    };

const RECEIPT_COMMAND_PATTERN = /(^|\s)\/receipt(?:@\w+)?(?:\s|$)/i;
const INCOME_COMMAND_PATTERN = /(^|\s)\/income(?:@\w+)?(?:\s|$)/i;
const GYM_COMMAND_PATTERN = /(^|\s)\/gym(?:@\w+)?(?:\s|$)/i;
const MODEL_HEALTH_COMMAND_PATTERN = /(^|\s)\/modelhealth(?:@\w+)?(?:\s|$)/i;
const RECEIPT_CONFIRMATION_PATTERN =
  /^(?:callback_data:\s*)?(?:receipt_(?:confirm|reject):[A-Za-z0-9_-]+|\/receipt_(?:confirm|reject)\s+[A-Za-z0-9_-]+)$/i;

export function detectTaskTrigger(text: string, hasMedia: boolean): TaskTrigger {
  const hasReceipt = RECEIPT_COMMAND_PATTERN.test(text);
  const hasIncome = INCOME_COMMAND_PATTERN.test(text);
  const hasGym = GYM_COMMAND_PATTERN.test(text);

  if (RECEIPT_CONFIRMATION_PATTERN.test(text)) {
    return { kind: "receipt-confirmation", source: "receipt_confirmation" };
  }

  if (MODEL_HEALTH_COMMAND_PATTERN.test(text)) {
    return { kind: "model-health", source: "modelhealth_command" };
  }

  const requestedTasks = [hasReceipt || hasIncome, hasGym].filter(Boolean).length;
  if (requestedTasks > 1 || (hasReceipt && hasIncome)) {
    return {
      kind: "ambiguous",
      reason: "Use one task command at a time."
    };
  }

  if (hasIncome) {
    return hasMedia
      ? { kind: "receipt-assistant", intent: "income", source: "income_command" }
      : { kind: "missing-media", task: "receipt-assistant", label: "income" };
  }

  if (hasReceipt) {
    return hasMedia
      ? { kind: "receipt-assistant", intent: "receipt", source: "receipt_command" }
      : { kind: "missing-media", task: "receipt-assistant", label: "receipt" };
  }

  if (hasGym) {
    return hasMedia
      ? { kind: "calory-assistant", source: "gym_command" }
      : { kind: "missing-media", task: "calory-assistant", label: "gym" };
  }

  return { kind: "unhandled" };
}

export function shouldGateDefaultAgentReply(text: string, hasMedia: boolean): boolean {
  return detectTaskTrigger(text, hasMedia).kind !== "unhandled";
}
