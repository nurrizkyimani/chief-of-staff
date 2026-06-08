import {
  pickChatId,
  pickMessageId,
  pickTelegramSendChatId,
  pickText
} from "./openclaw-event.ts";
import { describeMessageShape, logStep, preview } from "./logging.ts";
import { collectMediaCandidates } from "./media.ts";
import type { TaskRouterContext } from "./types.ts";

export function isPreprocessedMessageEvent(event: any): boolean {
  return event?.type === "message" && event?.action === "preprocessed";
}

export function buildTaskRouterContext(event: any): TaskRouterContext {
  const text = pickText(event).trim();
  const mediaCandidates = collectMediaCandidates(event, text);

  return {
    event,
    text,
    mediaCandidates,
    telegramChatId: pickTelegramSendChatId(event),
    chatId: pickChatId(event),
    baseMessageId: pickMessageId(event),
    receivedAt: new Date(event?.timestamp ?? Date.now()).toISOString(),
    sourcePlatform: pickSourcePlatform(event)
  };
}

export function logTaskRouterStart(context: TaskRouterContext): void {
  logStep("task_router.start", {
    type: context.event?.type,
    action: context.event?.action,
    channelId: context.event?.context?.channelId,
    sessionKey: context.event?.sessionKey,
    messageShape: Array.isArray(context.event?.messages)
      ? describeMessageShape(context.event.messages)
      : ["not-array"],
    textPreview: preview(context.text)
  });
}

function pickSourcePlatform(event: any): string {
  const metadata = event?.context?.metadata ?? {};
  const raw = String(
    metadata.platform ??
      metadata.provider ??
      metadata.channelId ??
      event?.context?.channelId ??
      event?.messageProvider ??
      "openclaw"
  )
    .trim()
    .toLowerCase();

  if (!raw) return "openclaw";
  if (raw.includes("telegram")) return "telegram";
  if (raw.includes("whatsapp")) return "whatsapp";
  if (raw.includes("gmail")) return "gmail";
  return raw.replace(/[^a-z0-9_-]+/g, "_").slice(0, 32) || "openclaw";
}
