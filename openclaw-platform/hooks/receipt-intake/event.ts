import {
  TELEGRAM_CHAT_ID_PREFIX_PATTERN,
  TELEGRAM_GROUP_CHAT_ID_PREFIX_PATTERN,
  TELEGRAM_NUMERIC_ID_PATTERN,
  TELEGRAM_SENDER_CHAT_ID_PATTERN,
  TELEGRAM_TOPIC_CHAT_ID_PATTERN,
  TELEGRAM_TOPIC_SENDER_CHAT_ID_PATTERN
} from "./constants.js";
import { describeMessageShape, logStep, preview, safeJson } from "./logging.js";

// toText converts mixed event content into plain text.
export function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter((item) => item.trim().length > 0)
      .join("");
  }

  if (typeof value === "object") {
    const candidate = value as {
      text?: unknown;
      content?: unknown;
      value?: unknown;
      message?: { content?: unknown };
    };

    if (typeof candidate.text === "string") return candidate.text;
    if (candidate.content !== undefined) return toText(candidate.content);
    if (candidate.value !== undefined) return toText(candidate.value);
    if (candidate.message?.content !== undefined) return toText(candidate.message.content);

    return safeJson(value);
  }

  return String(value);
}

// pickText selects the best text field from an event.
export function pickText(event: any): string {
  return (
    event?.context?.bodyForAgent ??
    event?.context?.content ??
    event?.context?.text ??
    ""
  );
}

// pushMessage replaces event messages with controlled response text.
export function pushMessage(event: any, text: string): void {
  if (!Array.isArray(event?.messages)) return;

  const normalizedText = toText(text).trim();
  const beforeCount = event.messages.length;
  const beforeShape = describeMessageShape(event.messages);

  const retained = event.messages
    .filter((item: unknown) => typeof item === "string")
    .map((item: string) => item.trim())
    .filter((item: string) => item.length > 0);

  const next = normalizedText.length > 0 ? [...retained, normalizedText] : retained;
  event.messages.splice(0, event.messages.length, ...next);

  logStep("pushMessage", {
    beforeCount,
    beforeShape,
    retainedStrings: retained.length,
    pushedPreview: preview(normalizedText),
    afterCount: event.messages.length
  });
}

// pickChatId finds a stable chat id for receipt metadata.
export function pickChatId(event: any): string {
  const metadata = event?.context?.metadata ?? {};
  return String(
    metadata.chatId ??
      metadata.conversationId ??
      event?.context?.conversationId ??
      event?.context?.senderId ??
      event?.context?.groupId ??
      metadata.channelId ??
      event?.context?.channelId ??
      event?.context?.from?.id ??
      event?.context?.from ??
      event?.sessionKey ??
      "unknown-chat"
  );
}

// extractNumericTelegramId normalizes Telegram ids from mixed values.
function extractNumericTelegramId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const candidates = [
    raw,
    raw.replace(TELEGRAM_CHAT_ID_PREFIX_PATTERN, ""),
    raw.replace(TELEGRAM_GROUP_CHAT_ID_PREFIX_PATTERN, "")
  ];

  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized) continue;

    const direct = normalized.match(TELEGRAM_NUMERIC_ID_PATTERN);
    if (direct) return direct[0];

    const withTopic = normalized.match(TELEGRAM_TOPIC_CHAT_ID_PATTERN);
    if (withTopic?.[1]) return withTopic[1];

    const withSender = normalized.match(TELEGRAM_SENDER_CHAT_ID_PATTERN);
    if (withSender?.[1]) return withSender[1];

    const withTopicAndSender = normalized.match(TELEGRAM_TOPIC_SENDER_CHAT_ID_PATTERN);
    if (withTopicAndSender?.[1]) return withTopicAndSender[1];
  }

  return null;
}

// pickTelegramAllowedFromId finds the configured Telegram allow-list id.
function pickTelegramAllowedFromId(event: any): string | null {
  const cfg = event?.context?.cfg;
  const candidates = [
    cfg?.channels?.telegram?.allowFrom,
    cfg?.channels?.telegram?.groupAllowFrom,
    cfg?.telegram?.allowFrom,
    cfg?.telegram?.groupAllowFrom
  ];

  for (const candidate of candidates) {
    const values = Array.isArray(candidate) ? candidate : [candidate];
    for (const value of values) {
      const id = extractNumericTelegramId(value);
      if (id) return id;
    }
  }

  return null;
}

// pickTelegramSendChatId finds the Telegram chat id for direct replies.
export function pickTelegramSendChatId(event: any): string | null {
  const metadata = event?.context?.metadata ?? {};
  const context = event?.context ?? {};
  const from = event?.context?.from ?? {};
  const metadataFrom = metadata.from ?? {};
  const metadataChat = metadata.chat ?? {};
  const metadataMessage = metadata.message ?? {};
  const metadataUpdate = metadata.update ?? {};
  const contextRaw = context.raw ?? {};
  const contextMessage = context.message ?? {};
  const contextChat = context.chat ?? {};
  const contextSender = context.sender ?? {};
  const candidates = [
    metadata.chatId,
    metadata.conversationId,
    metadata.groupId,
    metadata.targetChatId,
    metadata.userId,
    metadata.senderId,
    metadata.fromId,
    metadata.telegramChatId,
    metadata.telegramUserId,
    metadata.chat_id,
    metadata.user_id,
    metadata.sender_id,
    metadataChat.id,
    metadataMessage.chat?.id,
    metadataUpdate.message?.chat?.id,
    metadataUpdate.callback_query?.message?.chat?.id,
    metadataFrom.id,
    metadata.from,
    metadata.to,
    context.chatId,
    context.conversationId,
    context.groupId,
    context.targetChatId,
    context.userId,
    context.senderId,
    contextSender.id,
    contextChat.id,
    contextMessage.chat?.id,
    contextRaw.message?.chat?.id,
    contextRaw.callback_query?.message?.chat?.id,
    context.from,
    context.to,
    from.id,
    from.chatId,
    from.conversationId,
    from.groupId,
    from.userId,
    from.senderId
  ];

  for (const candidate of candidates) {
    const normalized = extractNumericTelegramId(candidate);
    if (normalized) return normalized;
  }

  const fallback = extractNumericTelegramId(pickChatId(event));
  if (fallback) return fallback;

  const allowFromFallback = pickTelegramAllowedFromId(event);
  if (allowFromFallback) return allowFromFallback;

  return null;
}

// pickMessageId finds a stable message id for receipt source metadata.
export function pickMessageId(event: any): string {
  const metadata = event?.context?.metadata ?? {};
  return String(
    metadata.messageId ??
      event?.context?.messageId ??
      event?.context?.from?.messageId ??
      event?.timestamp ??
      Date.now()
  );
}

// includesTelegramTag checks whether a value mentions Telegram.
function includesTelegramTag(value: unknown): boolean {
  return String(value ?? "").toLowerCase().includes("telegram");
}

// isTelegramEvent checks whether the event came from Telegram.
export function isTelegramEvent(event: any): boolean {
  const metadata = event?.context?.metadata ?? {};
  const candidates = [
    metadata.platform,
    metadata.provider,
    metadata.channelId,
    event?.context?.channelId,
    event?.context?.from?.provider,
    event?.context?.from?.channelId,
    event?.sessionKey
  ];
  return candidates.some(includesTelegramTag);
}

// suppressDownstreamProcessing prevents the default assistant reply path.
export function suppressDownstreamProcessing(event: any, reason: string): void {
  const context = event?.context;
  const noReply = "NO_REPLY";

  if (context && typeof context === "object") {
    const mutable = context as Record<string, unknown>;
    const keys = [
      "bodyForAgent",
      "bodyForCommands",
      "content",
      "text",
      "body",
      "rawBody",
      "commandBody",
      "transcript"
    ];
    for (const key of keys) {
      mutable[key] = noReply;
    }
  }

  if (Array.isArray(event?.messages)) {
    event.messages.splice(0, event.messages.length);
  }

  logStep("event.suppress_downstream", {
    reason,
    token: noReply
  });
}
