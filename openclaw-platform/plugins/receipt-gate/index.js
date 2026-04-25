import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const RECEIPT_COMMAND_RE = /^\/receipt(?:@\w+)?(?:\s|$)/i;
const INCOME_COMMAND_RE = /^\/income(?:@\w+)?(?:\s|$)/i;
const MODELHEALTH_COMMAND_RE = /^\/modelhealth(?:\s|$)/i;
const CONFIRMATION_RE =
  /^(?:callback_data:\s*)?(?:receipt_(?:confirm|reject):[A-Za-z0-9_-]+|\/receipt_(?:confirm|reject)\s+[A-Za-z0-9_-]+)$/i;

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

function hasReceiptMedia(event) {
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
  const text = [
    textFrom(event?.cleanedBody),
    textFrom(event?.body),
    textFrom(event?.bodyForAgent),
    textFrom(event?.content)
  ].find(Boolean);

  if (!text) return hasReceiptMedia(event) ? "receipt_media" : null;
  if (RECEIPT_COMMAND_RE.test(text)) return "receipt_command";
  if (INCOME_COMMAND_RE.test(text)) return "income_command";
  if (MODELHEALTH_COMMAND_RE.test(text)) return "modelhealth_command";
  if (CONFIRMATION_RE.test(text)) return "receipt_confirmation";
  if (hasReceiptMedia(event)) return "receipt_media";
  return null;
}

export default definePluginEntry({
  id: "receipt-gate",
  name: "Receipt Gate",
  description: "Suppresses default model replies for deterministic receipt intake commands.",
  register(api) {
    api.on("before_agent_reply", (event, ctx) => {
      if (ctx.channelId !== "telegram" && ctx.messageProvider !== "telegram") return;

      const reason = shouldSilence(event);
      if (!reason) return;

      api.logger.info("silencing default agent reply", {
        reason,
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
