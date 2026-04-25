import type { ReceiptPayload } from "../../dist/assistants/receipt-assistant/schemas/receipt.v1.1.schema.js";

export type MediaCandidate = {
  url: string;
  mimeType?: string;
  sourceId?: string;
};

export type MediaReadResult = {
  binary: Buffer;
  mimeType: string;
  resolvedFrom: string;
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

export type ConfirmationAction = {
  token: string;
  decision: "confirm" | "reject";
};

export type ReceiptIntent = "receipt" | "income";

export type ReceiptIntentSource = "media_default" | "receipt_command" | "income_command";

export type MistralHealthResult =
  | {
      ok: true;
      model: string;
      servedModel: string;
      latencyMs: number;
      sample: string;
    }
  | {
      ok: false;
      model: string;
      latencyMs: number;
      status?: number;
      error: string;
      details?: string;
    };
