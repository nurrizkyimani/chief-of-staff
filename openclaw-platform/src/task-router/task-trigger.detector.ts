import { parseWishlistCommand } from "../usecases/wishlist-assistant/wishlist-markdown.js";

export type MediaKindHint =
  | boolean
  | {
      hasMedia: boolean;
      hasImage?: boolean;
      hasPdf?: boolean;
    };

export type TaskTrigger =
  | {
      kind: "receipt-assistant";
      intent: "receipt" | "income";
      source: "receipt_command" | "income_command" | "media_default";
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
      kind: "cicilan-assistant";
      source: "cicilan_text";
    }
  | {
      kind: "cicilan-confirmation";
      source: "cicilan_confirmation";
    }
  | {
      kind: "model-health";
      source: "modelhealth_command";
    }
  | {
      kind: "wishlist-assistant";
      source: "wishlist_command" | "wishlist_import";
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
const CICILAN_TRIGGER_PATTERN = /\b(?:cicil(?:an)?|installments?|paylater|spaylater|spl)\b/i;
const RECEIPT_CONFIRMATION_PATTERN =
  /^(?:callback_data:\s*)?(?:receipt_(?:confirm|reject):[A-Za-z0-9_-]+|receipt_method:[A-Za-z0-9_-]+:[a-z0-9-]+|\/receipt_(?:confirm|reject)\s+[A-Za-z0-9_-]+|\/receipt_method\s+[A-Za-z0-9_-]+\s+[a-z0-9-]+)$/i;
const CICILAN_CONFIRMATION_PATTERN =
  /^(?:callback_data:\s*)?(?:cicilan_(?:confirm|reject):[A-Za-z0-9_-]+|cicilan_method:[A-Za-z0-9_-]+:[a-z0-9-]+|\/cicilan_(?:confirm|reject)\s+[A-Za-z0-9_-]+|\/cicilan_method\s+[A-Za-z0-9_-]+\s+[a-z0-9-]+)$/i;

export function detectTaskTrigger(text: string, media: MediaKindHint): TaskTrigger {
  const mediaKind = normalizeMediaKind(media);
  const hasMedia = mediaKind.hasMedia;
  const hasPdfOnly = mediaKind.hasPdf && !mediaKind.hasImage;
  const hasReceipt = RECEIPT_COMMAND_PATTERN.test(text);
  const hasIncome = INCOME_COMMAND_PATTERN.test(text);
  const hasGym = GYM_COMMAND_PATTERN.test(text);

  if (RECEIPT_CONFIRMATION_PATTERN.test(text)) {
    return { kind: "receipt-confirmation", source: "receipt_confirmation" };
  }
  if (CICILAN_CONFIRMATION_PATTERN.test(text)) {
    return { kind: "cicilan-confirmation", source: "cicilan_confirmation" };
  }

  if (MODEL_HEALTH_COMMAND_PATTERN.test(text)) {
    return { kind: "model-health", source: "modelhealth_command" };
  }

  if (CICILAN_TRIGGER_PATTERN.test(text)) {
    return { kind: "cicilan-assistant", source: "cicilan_text" };
  }

  const wishlistCommand = parseWishlistCommand(text);
  if (wishlistCommand) {
    return {
      kind: "wishlist-assistant",
      source: wishlistCommand.kind === "import" ? "wishlist_import" : "wishlist_command"
    };
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

  if (hasMedia && !hasPdfOnly) {
    return { kind: "receipt-assistant", intent: "receipt", source: "media_default" };
  }

  return { kind: "unhandled" };
}

export function shouldGateDefaultAgentReply(text: string, media: MediaKindHint): boolean {
  return detectTaskTrigger(text, media).kind !== "unhandled";
}

function normalizeMediaKind(media: MediaKindHint): {
  hasMedia: boolean;
  hasImage: boolean;
  hasPdf: boolean;
} {
  if (typeof media === "boolean") {
    return {
      hasMedia: media,
      hasImage: media,
      hasPdf: false
    };
  }

  return {
    hasMedia: media.hasMedia,
    hasImage: Boolean(media.hasImage),
    hasPdf: Boolean(media.hasPdf)
  };
}
