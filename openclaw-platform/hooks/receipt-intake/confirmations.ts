import { randomBytes } from "node:crypto";
import type { ReceiptPayload } from "../../dist/assistants/receipt-assistant/schemas/receipt.v1.1.schema.js";
import {
  CALLBACK_CONFIRM_PREFIX,
  CALLBACK_DATA_PAYLOAD_PATTERN,
  CALLBACK_REJECT_PREFIX,
  CONFIRMATION_TOKEN_NON_ALPHANUMERIC_DASH_UNDERSCORE_PATTERN,
  PENDING_CONFIRMATION_TTL_MS,
  RECEIPT_CONFIRM_COMMAND_PATTERN,
  RECEIPT_REJECT_COMMAND_PATTERN
} from "./constants.js";
import type { ConfirmationAction, PendingConfirmation } from "./types.js";

const pendingConfirmations = new Map<string, PendingConfirmation>();

// parseConfirmationAction reads a confirm or reject command from text.
export function parseConfirmationAction(text: string): ConfirmationAction | null {
  const normalized = text.trim();

  if (normalized.startsWith(CALLBACK_CONFIRM_PREFIX)) {
    return {
      decision: "confirm",
      token: normalized.slice(CALLBACK_CONFIRM_PREFIX.length)
    };
  }
  if (normalized.startsWith(CALLBACK_REJECT_PREFIX)) {
    return {
      decision: "reject",
      token: normalized.slice(CALLBACK_REJECT_PREFIX.length)
    };
  }

  const callbackMatch = normalized.match(CALLBACK_DATA_PAYLOAD_PATTERN);
  const callbackPayload = callbackMatch?.[1]?.trim() ?? "";
  if (callbackPayload.startsWith(CALLBACK_CONFIRM_PREFIX)) {
    return {
      decision: "confirm",
      token: callbackPayload.slice(CALLBACK_CONFIRM_PREFIX.length)
    };
  }
  if (callbackPayload.startsWith(CALLBACK_REJECT_PREFIX)) {
    return {
      decision: "reject",
      token: callbackPayload.slice(CALLBACK_REJECT_PREFIX.length)
    };
  }

  const confirmMatch = normalized.match(RECEIPT_CONFIRM_COMMAND_PATTERN);
  if (confirmMatch?.[1]) {
    return {
      decision: "confirm",
      token: confirmMatch[1]
    };
  }

  const rejectMatch = normalized.match(RECEIPT_REJECT_COMMAND_PATTERN);
  if (rejectMatch?.[1]) {
    return {
      decision: "reject",
      token: rejectMatch[1]
    };
  }

  return null;
}

// prunePendingConfirmations removes expired pending confirmations.
export function prunePendingConfirmations(nowMs: number = Date.now()): void {
  for (const [token, pending] of pendingConfirmations.entries()) {
    if (nowMs - pending.createdAtMs > PENDING_CONFIRMATION_TTL_MS) {
      pendingConfirmations.delete(token);
    }
  }
}

// createConfirmationToken creates a short token for one confirmation.
function createConfirmationToken(): string {
  const rand = randomBytes(8).toString("base64url").replace(CONFIRMATION_TOKEN_NON_ALPHANUMERIC_DASH_UNDERSCORE_PATTERN, "");
  return rand.slice(0, 12) || `${Date.now().toString(36)}`;
}

// savePendingConfirmation stores a parsed receipt until the user decides.
export function savePendingConfirmation(
  payload: ReceiptPayload,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number
): string {
  prunePendingConfirmations();

  let token = createConfirmationToken();
  while (pendingConfirmations.has(token)) {
    token = createConfirmationToken();
  }

  pendingConfirmations.set(token, {
    token,
    payload,
    mediaIndex,
    totalMedia,
    pageNumber,
    totalPages,
    createdAtMs: Date.now()
  });

  return token;
}

// getPendingConfirmation returns a pending confirmation by token.
export function getPendingConfirmation(token: string): PendingConfirmation | undefined {
  return pendingConfirmations.get(token);
}

// deletePendingConfirmation removes a pending confirmation by token.
export function deletePendingConfirmation(token: string): void {
  pendingConfirmations.delete(token);
}
