export type CaloryAssistantExecutorInput = {
  sourcePlatform: string;
  chatId: string;
  baseMessageId: string;
  receivedAt: string;
  text: string;
  mediaCount: number;
};

export type CaloryAssistantExecutorResult = {
  handled: true;
  messages: string[];
};
