import type { CaloryAssistantExecutorInput, CaloryAssistantExecutorResult } from "./calory-assistant.types.js";

export async function executeCaloryAssistant(
  input: CaloryAssistantExecutorInput
): Promise<CaloryAssistantExecutorResult> {
  return {
    handled: true,
    messages: [
      `Calory assistant is not implemented yet. The /gym executor received ${input.mediaCount} media item(s) from ${input.sourcePlatform}.`
    ]
  };
}
