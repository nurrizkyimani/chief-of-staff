import type { ProcessCaloryAssistantInput, ProcessCaloryAssistantResult } from "./process-calory-assistant.types.js";

export async function processCaloryAssistant(
  input: ProcessCaloryAssistantInput
): Promise<ProcessCaloryAssistantResult> {
  return {
    handled: true,
    messages: [
      `Calory assistant is not implemented yet. The /gym executor received ${input.mediaCount} media item(s) from ${input.sourcePlatform}.`
    ]
  };
}
