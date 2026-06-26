import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const RECEIPT_COMMAND_RE = /^\/receipt(?:@\w+)?(?:\s|$)/i;
const INCOME_COMMAND_RE = /^\/income(?:@\w+)?(?:\s|$)/i;
const GYM_COMMAND_RE = /^\/gym(?:@\w+)?(?:\s|$)/i;
const MODELHEALTH_COMMAND_RE = /^\/modelhealth(?:\s|$)/i;
const CONFIRMATION_RE =
  /^(?:callback_data:\s*)?(?:receipt_(?:confirm|reject):[A-Za-z0-9_-]+|\/receipt_(?:confirm|reject)\s+[A-Za-z0-9_-]+)$/i;
const NO_REPLY_RE = /^NO_REPLY$/i;
const MEDIA_PLACEHOLDER_RE = /^<media:[^>]+>(?:\s*\([^)]*\))?$/i;

function textFrom(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasMediaValue(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value !== "object") return false;

  return [
    value.media,
    value.attachment,
    value.attachments,
    value.mediaUrl,
    value.attachmentUrl,
    value.fileUrl,
    value.downloadUrl,
    value.filePath,
    value.mediaPath,
    value.url
  ].some(hasMediaValue);
}

function hasTaskMedia(event) {
  return [
    event?.media,
    event?.attachment,
    event?.attachments,
    event?.context?.media,
    event?.context?.attachment,
    event?.context?.attachments,
    event?.context?.metadata?.media,
    event?.context?.metadata?.mediaUrl,
    event?.context?.metadata?.attachmentUrl,
    event?.context?.metadata?.fileUrl,
    event?.context?.metadata?.attachments
  ].some(hasMediaValue);
}

function shouldSilence(event) {
  const textCandidates = [
    textFrom(event?.cleanedBody),
    textFrom(event?.body),
    textFrom(event?.bodyForAgent),
    textFrom(event?.content),
    textFrom(event?.context?.bodyForAgent),
    textFrom(event?.context?.bodyForCommands),
    textFrom(event?.context?.content),
    textFrom(event?.context?.text),
    textFrom(event?.context?.body),
    textFrom(event?.context?.rawBody),
    textFrom(event?.context?.commandBody),
    textFrom(event?.context?.transcript)
  ].filter(Boolean);
  const hasMedia = hasTaskMedia(event) || textCandidates.some((candidate) => MEDIA_PLACEHOLDER_RE.test(candidate));

  if (textCandidates.some((candidate) => NO_REPLY_RE.test(candidate))) return "task_no_reply_marker";

  const text = textCandidates[0];
  if (!text) return hasMedia ? "task_media" : null;
  if (MEDIA_PLACEHOLDER_RE.test(text)) return "task_media";
  if (RECEIPT_COMMAND_RE.test(text)) return hasMedia ? "receipt_command" : "receipt_missing_media";
  if (INCOME_COMMAND_RE.test(text)) return hasMedia ? "income_command" : "income_missing_media";
  if (GYM_COMMAND_RE.test(text)) return hasMedia ? "gym_command" : "gym_missing_media";
  if (MODELHEALTH_COMMAND_RE.test(text)) return "modelhealth_command";
  if (CONFIRMATION_RE.test(text)) return "receipt_confirmation";
  if (hasMedia) return "task_media";
  return null;
}

export default definePluginEntry({
  id: "task-gate",
  name: "Task Gate",
  description: "Suppresses default model replies for deterministic task commands.",
  register(api) {
    api.on("before_agent_reply", (event, ctx) => {
      const reason = shouldSilence(event);
      if (!reason) return;

      api.logger.info("silencing default agent reply", {
        reason,
        channelId: ctx.channelId,
        messageProvider: ctx.messageProvider,
        sessionKey: ctx.sessionKey
      });

      return {
        handled: true,
        reason,
        reply: {
          text: "NO_REPLY"
        }
      };
    });
  }
});
