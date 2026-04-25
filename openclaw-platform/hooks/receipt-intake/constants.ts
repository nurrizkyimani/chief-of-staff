import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../dist/config/env.js";

export const MAX_PDF_PAGES = env.RECEIPT_MAX_PDF_PAGES;
export const PENDING_CONFIRMATION_TTL_MS = env.RECEIPT_CONFIRMATION_TTL_MS;
export const TELEGRAM_API_BASE = env.TELEGRAM_API_BASE;
export const MISTRAL_API_BASE = env.MISTRAL_API_BASE;
export const CALLBACK_CONFIRM_PREFIX = "receipt_confirm:";
export const CALLBACK_REJECT_PREFIX = "receipt_reject:";
export const LOG_PREFIX = "[receipt-intake]";
export const LOG_PREVIEW_MAX = 360;

// WHITESPACE_SEQUENCE_PATTERN matches one or more whitespace characters for text compaction.
export const WHITESPACE_SEQUENCE_PATTERN = /\s+/g;

// CALLBACK_DATA_PAYLOAD_PATTERN matches Telegram callback_data text and captures the payload.
export const CALLBACK_DATA_PAYLOAD_PATTERN = /^callback_data:\s*(.+)$/i;

// RECEIPT_CONFIRM_COMMAND_PATTERN matches /receipt_confirm followed by a token.
export const RECEIPT_CONFIRM_COMMAND_PATTERN = /^\/receipt_confirm\s+([A-Za-z0-9_-]+)$/i;

// RECEIPT_REJECT_COMMAND_PATTERN matches /receipt_reject followed by a token.
export const RECEIPT_REJECT_COMMAND_PATTERN = /^\/receipt_reject\s+([A-Za-z0-9_-]+)$/i;

// CONFIRMATION_TOKEN_NON_ALPHANUMERIC_DASH_UNDERSCORE_PATTERN matches anything except letters, numbers, dash, and underscore.
export const CONFIRMATION_TOKEN_NON_ALPHANUMERIC_DASH_UNDERSCORE_PATTERN = /[^A-Za-z0-9_-]/g;

// RECEIPT_COMMAND_PATTERN matches the /receipt command as a standalone command word.
export const RECEIPT_COMMAND_PATTERN = /(^|\s)\/receipt(?:\s|$)/i;

// MODEL_HEALTH_COMMAND_PATTERN matches /modelhealth with an optional bot username.
export const MODEL_HEALTH_COMMAND_PATTERN = /(^|\s)\/modelhealth(?:@\w+)?(?:\s|$)/i;

// TELEGRAM_CHAT_ID_PREFIX_PATTERN matches a leading telegram: or tg: chat id prefix.
export const TELEGRAM_CHAT_ID_PREFIX_PATTERN = /^(telegram|tg):/i;

// TELEGRAM_GROUP_CHAT_ID_PREFIX_PATTERN matches a leading telegram:group: or tg:group: prefix.
export const TELEGRAM_GROUP_CHAT_ID_PREFIX_PATTERN = /^(telegram|tg):group:/i;

// TELEGRAM_NUMERIC_ID_PATTERN matches a plain Telegram numeric id.
export const TELEGRAM_NUMERIC_ID_PATTERN = /^-?\d+$/;

// TELEGRAM_TOPIC_CHAT_ID_PATTERN matches a Telegram chat id with a topic suffix.
export const TELEGRAM_TOPIC_CHAT_ID_PATTERN = /^(-?\d+):topic:\d+$/i;

// TELEGRAM_SENDER_CHAT_ID_PATTERN matches a Telegram chat id with a sender suffix.
export const TELEGRAM_SENDER_CHAT_ID_PATTERN = /^(-?\d+):sender:-?\d+$/i;

// TELEGRAM_TOPIC_SENDER_CHAT_ID_PATTERN matches a Telegram chat id with topic and sender suffixes.
export const TELEGRAM_TOPIC_SENDER_CHAT_ID_PATTERN = /^(-?\d+):topic:\d+:sender:-?\d+$/i;

// HTTP_URL_PREFIX_PATTERN matches strings that start with an HTTP or HTTPS URL scheme.
export const HTTP_URL_PREFIX_PATTERN = /^https?:\/\//i;

// HTTP_URL_IN_TEXT_PATTERN matches HTTP or HTTPS URLs embedded in message text.
export const HTTP_URL_IN_TEXT_PATTERN = /https?:\/\/\S+/g;

// MESSAGE_ID_SUFFIX_DISALLOWED_CHARACTER_PATTERN matches characters not allowed in message id suffixes.
export const MESSAGE_ID_SUFFIX_DISALLOWED_CHARACTER_PATTERN = /[^a-z0-9_-]+/g;

// MARKDOWN_TABLE_LINE_BREAK_PATTERN matches line breaks that must be flattened inside table cells.
export const MARKDOWN_TABLE_LINE_BREAK_PATTERN = /\r?\n/g;

// MARKDOWN_TABLE_PIPE_PATTERN matches pipe characters that must be escaped inside table cells.
export const MARKDOWN_TABLE_PIPE_PATTERN = /\|/g;

export const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HOOK_DIR, "../../..");
export const OPENCLAW_PLATFORM_ROOT = resolve(HOOK_DIR, "../..");
export const OPENCLAW_HOME_ROOT = env.OPENCLAW_HOME
  ? resolve(env.OPENCLAW_HOME)
  : resolve(OPENCLAW_PLATFORM_ROOT, ".openclaw-home");
export const RECEIPT_JOURNAL_PATH = env.RECEIPT_JOURNAL_PATH;
