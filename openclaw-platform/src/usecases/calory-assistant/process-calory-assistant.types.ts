export type ProcessCaloryAssistantInput = {
  sourcePlatform: string;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
  text: string;
  mediaCount: number;
};

export type ProcessCaloryAssistantResult = {
  handled: true;
  messages: string[];
};
