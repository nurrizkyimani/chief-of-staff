import type { MediaCandidate } from "../integrations/openclaw/media-source.js";

export type TaskRouterInput = {
  text: string;
  mediaCandidates: MediaCandidate[];
  sourcePlatform: string;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
};

export type TaskConfirmation = {
  token: string;
  previewText: string;
  paymentMethod: string;
  paymentMethodOptions: string[];
  confirmCommand: string;
  rejectCommand: string;
  methodCommands: Array<{
    paymentMethod: string;
    command: string;
    callbackData: string;
  }>;
  confirmCallbackData: string;
  rejectCallbackData: string;
};

export type TaskRouterResult = {
  handled: boolean;
  suppressReason?: string;
  messages: string[];
  confirmations: TaskConfirmation[];
};

export type TaskRouterLogger = {
  log(step: string, data?: Record<string, unknown>): void;
};
