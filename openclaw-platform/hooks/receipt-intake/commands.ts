import { INCOME_COMMAND_PATTERN, MODEL_HEALTH_COMMAND_PATTERN, RECEIPT_COMMAND_PATTERN } from "./constants.ts";
import type { ReceiptIntent, ReceiptIntentSource } from "./types.ts";

export type ReceiptIntentResolution =
  | {
      status: "parse";
      intent: ReceiptIntent;
      source: ReceiptIntentSource;
    }
  | {
      status: "missing_media";
      intent: ReceiptIntent;
      source: Exclude<ReceiptIntentSource, "media_default">;
    }
  | {
      status: "ambiguous";
    }
  | {
      status: "unsupported";
    };

// isReceiptCommand checks whether text asks for receipt intake.
export function isReceiptCommand(text: string): boolean {
  return RECEIPT_COMMAND_PATTERN.test(text);
}

// isIncomeCommand checks whether text asks for income intake.
export function isIncomeCommand(text: string): boolean {
  return INCOME_COMMAND_PATTERN.test(text);
}

// resolveReceiptIntent routes media into receipt parsing by default, with /income as an explicit override.
export function resolveReceiptIntent(text: string, hasMedia: boolean): ReceiptIntentResolution {
  const hasReceiptCommand = isReceiptCommand(text);
  const hasIncomeCommand = isIncomeCommand(text);

  if (hasReceiptCommand && hasIncomeCommand) {
    return { status: "ambiguous" };
  }

  if (hasIncomeCommand) {
    return hasMedia
      ? { status: "parse", intent: "income", source: "income_command" }
      : { status: "missing_media", intent: "income", source: "income_command" };
  }

  if (hasReceiptCommand) {
    return hasMedia
      ? { status: "parse", intent: "receipt", source: "receipt_command" }
      : { status: "missing_media", intent: "receipt", source: "receipt_command" };
  }

  if (hasMedia) {
    return { status: "parse", intent: "receipt", source: "media_default" };
  }

  return { status: "unsupported" };
}

// isModelHealthCommand checks whether text asks for model health.
export function isModelHealthCommand(text: string): boolean {
  return MODEL_HEALTH_COMMAND_PATTERN.test(text);
}
