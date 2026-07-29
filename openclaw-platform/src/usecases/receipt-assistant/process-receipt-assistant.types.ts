import type { MediaCandidate } from "../../integrations/openclaw/media-source.js";
import type { ReceiptConfirmationRequest } from "../../usecases/receipt-assistant/queue-receipt-confirmation.js";

export type ReceiptAssistantIntent = "receipt" | "income";

export type ReceiptAssistantIntentSource =
  | "receipt_command"
  | "income_command"
  | "media_default"
  | "gmail_import";

export type ProcessReceiptAssistantInput = {
  sourcePlatform: string;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
  captionText?: string;
  mediaCandidates: MediaCandidate[];
  intent: ReceiptAssistantIntent;
  intentSource: ReceiptAssistantIntentSource;
};

export type ProcessReceiptAssistantResult = {
  handled: true;
  messages: string[];
  confirmations: ReceiptConfirmationRequest[];
};
