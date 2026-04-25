import { env } from "../../dist/config/env.js";
import { CALLBACK_CONFIRM_PREFIX, CALLBACK_REJECT_PREFIX, TELEGRAM_API_BASE } from "./constants.js";
import { pushMessage } from "./event.js";
import { logStep, preview } from "./logging.js";

// sendTelegramInlineConfirmation sends a receipt preview with Yes/No buttons.
export async function sendTelegramInlineConfirmation(chatId: string, text: string, token: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  try {
    logStep("telegram.inline.request", {
      chatId,
      token,
      textPreview: preview(text)
    });

    const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Yes",
                callback_data: `${CALLBACK_CONFIRM_PREFIX}${token}`
              },
              {
                text: "No",
                callback_data: `${CALLBACK_REJECT_PREFIX}${token}`
              }
            ]
          ]
        }
      })
    });

    const responseBody = await response.text();
    logStep("telegram.inline.response", {
      chatId,
      status: response.status,
      ok: response.ok,
      bodyPreview: preview(responseBody)
    });

    return response.ok;
  } catch (error) {
    logStep("telegram.inline.error", {
      chatId,
      error: (error as Error)?.message ?? "Unknown sendMessage error"
    });
    return false;
  }
}

// sendTelegramTextMessage sends plain text directly through Telegram.
export async function sendTelegramTextMessage(chatId: string, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  try {
    logStep("telegram.text.request", {
      chatId,
      textPreview: preview(text)
    });

    const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    const responseBody = await response.text();
    logStep("telegram.text.response", {
      chatId,
      status: response.status,
      ok: response.ok,
      bodyPreview: preview(responseBody)
    });

    return response.ok;
  } catch (error) {
    logStep("telegram.text.error", {
      chatId,
      error: (error as Error)?.message ?? "Unknown sendMessage error"
    });
    return false;
  }
}

// sendControlledText sends direct Telegram text or falls back to event messages.
export async function sendControlledText(event: any, telegramChatId: string | null, text: string): Promise<void> {
  const sentDirect = telegramChatId !== null ? await sendTelegramTextMessage(telegramChatId, text) : false;
  if (!sentDirect) {
    pushMessage(event, text);
  }
}
