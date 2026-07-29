import { env } from "../../dist/config/env.js";
import { logStep, preview } from "./logging.ts";
import { pushMessage } from "./openclaw-event.ts";

export async function sendTelegramInlineConfirmation(input: {
  chatId: string;
  text: string;
  token: string;
  paymentMethod: string;
  optionLabel?: string;
  methodButtons: Array<{
    text: string;
    callbackData: string;
  }>;
  confirmCallbackData: string;
  rejectCallbackData: string;
}): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  try {
    logStep("telegram.inline.request", {
      chatId: input.chatId,
      token: input.token,
      textPreview: preview(input.text)
    });

    const response = await fetch(`${env.TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        reply_markup: {
          inline_keyboard: buildConfirmationKeyboard(input)
        }
      })
    });

    const responseBody = await response.text();
    logStep("telegram.inline.response", {
      chatId: input.chatId,
      status: response.status,
      ok: response.ok,
      bodyPreview: preview(responseBody)
    });

    return response.ok;
  } catch (error) {
    logStep("telegram.inline.error", {
      chatId: input.chatId,
      error: (error as Error)?.message ?? "Unknown sendMessage error"
    });
    return false;
  }
}

function buildConfirmationKeyboard(input: {
  paymentMethod: string;
  optionLabel?: string;
  methodButtons: Array<{
    text: string;
    callbackData: string;
  }>;
  confirmCallbackData: string;
  rejectCallbackData: string;
}): Array<Array<{ text: string; callback_data: string }>> {
  if (!input.paymentMethod) {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let index = 0; index < input.methodButtons.length; index += 2) {
      rows.push(
        input.methodButtons.slice(index, index + 2).map((button) => ({
          text: button.text,
          callback_data: button.callbackData
        }))
      );
    }
    rows.push([{ text: "No", callback_data: input.rejectCallbackData }]);
    return rows;
  }

  return [
    [
      {
        text: `Save ${input.paymentMethod}`,
        callback_data: input.confirmCallbackData
      },
      {
        text: "No",
        callback_data: input.rejectCallbackData
      }
    ]
  ];
}

export async function sendTelegramTextMessage(chatId: string, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;

  try {
    logStep("telegram.text.request", {
      chatId,
      textPreview: preview(text)
    });

    const response = await fetch(`${env.TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
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

export async function sendControlledText(event: any, telegramChatId: string | null, text: string): Promise<void> {
  const sentDirect = telegramChatId !== null ? await sendTelegramTextMessage(telegramChatId, text) : false;
  if (!sentDirect) {
    pushMessage(event, text);
  }
}
