import type { TaskTrigger } from "../../dist/controllers/openclaw/task-trigger.detector.js";
import type { MediaCandidate } from "../../dist/integrations/openclaw/media-source.js";

export type TaskRouterContext = {
  event: any;
  text: string;
  mediaCandidates: MediaCandidate[];
  trigger: TaskTrigger;
  telegramChatId: string | null;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
  sourcePlatform: string;
};

export type ReceiptAssistantTrigger = Extract<TaskTrigger, { kind: "receipt-assistant" }>;

export type ReceiptTaskContext = TaskRouterContext & {
  trigger: ReceiptAssistantTrigger;
};
