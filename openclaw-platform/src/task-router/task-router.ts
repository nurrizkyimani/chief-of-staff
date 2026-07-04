import { handledTaskResult, unhandledTaskResult } from "./task-handler.js";
import { taskRegistry } from "./task-registry.js";
import type { TaskRouterInput, TaskRouterLogger, TaskRouterResult } from "./task.types.js";
import { detectTaskTrigger } from "./task-trigger.detector.js";
import { normalizeMimeType } from "../integrations/openclaw/media-source.js";

export async function routeTask(input: TaskRouterInput, logger?: TaskRouterLogger): Promise<TaskRouterResult> {
  const trigger = detectTaskTrigger(input.text, mediaKind(input.mediaCandidates));

  if (trigger.kind === "unhandled") {
    return unhandledTaskResult();
  }

  if (trigger.kind === "ambiguous") {
    return handledTaskResult({
      suppressReason: "task_ambiguous",
      messages: [trigger.reason]
    });
  }

  if (trigger.kind === "missing-media") {
    return handledTaskResult({
      suppressReason: `${trigger.task}_missing_media`,
      messages: [`Upload media with /${trigger.label}.`]
    });
  }

  const handler = taskRegistry.find((candidate) => candidate.canHandle(trigger));
  if (!handler) {
    return handledTaskResult({
      suppressReason: "task_unhandled",
      messages: ["Task is not implemented yet."]
    });
  }

  return handler.handle(input, trigger, logger);
}

function mediaKind(mediaCandidates: TaskRouterInput["mediaCandidates"]) {
  const mimeTypes = mediaCandidates.map((media) => normalizeMimeType(media.mimeType, media.url));
  return {
    hasMedia: mediaCandidates.length > 0,
    hasImage: mimeTypes.some((mime) => mime.startsWith("image/")),
    hasPdf: mimeTypes.some((mime) => mime === "application/pdf")
  };
}
