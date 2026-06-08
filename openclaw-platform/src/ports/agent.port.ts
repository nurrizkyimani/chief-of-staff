export type AgentRunInput = {
  message: string;
};

export type AgentRunResult = {
  text: string;
};

export type AgentPort = {
  run(input: AgentRunInput): Promise<AgentRunResult>;
};
