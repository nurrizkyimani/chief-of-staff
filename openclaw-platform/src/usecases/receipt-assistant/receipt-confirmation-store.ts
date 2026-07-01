import { randomBytes } from "node:crypto";
import type { ReceiptPayload } from "../../domains/receipts/receipt.schema.js";

export const CALLBACK_CONFIRM_PREFIX = "receipt_confirm:";
export const CALLBACK_REJECT_PREFIX = "receipt_reject:";
export const CALLBACK_METHOD_PREFIX = "receipt_method:";

const CALLBACK_DATA_PAYLOAD_PATTERN = /^callback_data:\s*(.+)$/i;
const CONFIRMATION_TOKEN_NON_ALPHANUMERIC_DASH_UNDERSCORE_PATTERN = /[^A-Za-z0-9_-]/g;
const RECEIPT_CONFIRM_COMMAND_PATTERN = /^\/receipt_confirm\s+([A-Za-z0-9_-]+)$/i;
const RECEIPT_REJECT_COMMAND_PATTERN = /^\/receipt_reject\s+([A-Za-z0-9_-]+)$/i;
const RECEIPT_METHOD_COMMAND_PATTERN = /^\/receipt_method\s+([A-Za-z0-9_-]+)\s+([a-z0-9-]+)$/i;

export type ConfirmationAction =
  | {
      token: string;
      decision: "confirm" | "reject";
    }
  | {
      token: string;
      decision: "method";
      paymentMethod: string;
    };

export type PendingConfirmation = {
  token: string;
  payload: ReceiptPayload;
  mediaIndex: number;
  totalMedia: number;
  pageNumber: number;
  totalPages: number;
  createdAtMs: number;
};

const pendingConfirmations = new Map<string, PendingConfirmation>();

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
  if (normalized.startsWith(CALLBACK_METHOD_PREFIX)) {
    return parseMethodCallbackPayload(normalized);
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
  if (callbackPayload.startsWith(CALLBACK_METHOD_PREFIX)) {
    return parseMethodCallbackPayload(callbackPayload);
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

  const methodMatch = normalized.match(RECEIPT_METHOD_COMMAND_PATTERN);
  if (methodMatch?.[1] && methodMatch[2]) {
    return {
      decision: "method",
      token: methodMatch[1],
      paymentMethod: methodMatch[2].toLowerCase()
    };
  }

  return null;
}

function parseMethodCallbackPayload(payload: string): ConfirmationAction | null {
  const rest = payload.slice(CALLBACK_METHOD_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === rest.length - 1) return null;

  return {
    decision: "method",
    token: rest.slice(0, separatorIndex),
    paymentMethod: rest.slice(separatorIndex + 1).toLowerCase()
  };
}

export function prunePendingConfirmations(ttlMs: number, nowMs: number = Date.now()): void {
  for (const [token, pending] of pendingConfirmations.entries()) {
    if (nowMs - pending.createdAtMs > ttlMs) {
      pendingConfirmations.delete(token);
    }
  }
}

function createConfirmationToken(): string {
  const rand = randomBytes(8)
    .toString("base64url")
    .replace(CONFIRMATION_TOKEN_NON_ALPHANUMERIC_DASH_UNDERSCORE_PATTERN, "");
  return rand.slice(0, 12) || `${Date.now().toString(36)}`;
}

export function savePendingConfirmation(
  payload: ReceiptPayload,
  mediaIndex: number,
  totalMedia: number,
  pageNumber: number,
  totalPages: number,
  ttlMs: number
): string {
  prunePendingConfirmations(ttlMs);

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

export function getPendingConfirmation(token: string): PendingConfirmation | undefined {
  return pendingConfirmations.get(token);
}

export function deletePendingConfirmation(token: string): void {
  pendingConfirmations.delete(token);
}
