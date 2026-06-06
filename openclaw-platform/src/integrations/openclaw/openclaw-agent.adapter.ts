import type { AgentPort, AgentRunInput, AgentRunResult } from "../../ports/agent.port.js";

export class OpenClawAgentAdapter implements AgentPort {
  async run(_input: AgentRunInput): Promise<AgentRunResult> {
    throw new Error("OpenClaw agent adapter is not implemented yet.");
  }
}
