import type { MediaCandidate } from "../../dist/integrations/openclaw/media-source.js";

export type TaskRouterContext = {
  event: any;
  text: string;
  mediaCandidates: MediaCandidate[];
  telegramChatId: string | null;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
  sourcePlatform: string;
};
