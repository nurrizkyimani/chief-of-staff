import { detectTaskTrigger } from "./task-trigger.detector.js";
import { handledResponse, unhandledResponse, type OpenClawTaskResponse } from "./openclaw-response.presenter.js";

export type TaskRouterControllerInput = {
  text: string;
  hasMedia: boolean;
};

export function routeTask(input: TaskRouterControllerInput): OpenClawTaskResponse {
  const trigger = detectTaskTrigger(input.text, input.hasMedia);

  if (trigger.kind === "unhandled") return unhandledResponse();
  if (trigger.kind === "ambiguous") return handledResponse("task_ambiguous", [trigger.reason]);
  if (trigger.kind === "missing-media") {
    return handledResponse(`${trigger.task}_missing_media`, [`Upload media with /${trigger.label}.`]);
  }
  if (trigger.kind === "calory-assistant") {
    return handledResponse("calory_assistant_not_implemented", [
      "Calory assistant is not implemented yet. The /gym route is reserved for the calory assistant executor."
    ]);
  }

  return handledResponse(trigger.source);
}
