import {
  CALLBACK_CONFIRM_PREFIX,
  CALLBACK_METHOD_PREFIX,
  CALLBACK_REJECT_PREFIX
} from "../../usecases/receipt-assistant/receipt-confirmation-store.js";
import type { ReceiptConfirmationRequest } from "../../usecases/receipt-assistant/queue-receipt-confirmation.js";
import type { TaskConfirmation } from "../../task-router/task.types.js";

export function presentReceiptConfirmations(
  confirmations: ReceiptConfirmationRequest[]
): TaskConfirmation[] {
  return confirmations.map((confirmation) => ({
    token: confirmation.token,
    previewText: confirmation.previewText,
    paymentMethod: confirmation.paymentMethod,
    paymentMethodOptions: confirmation.paymentMethodOptions,
    confirmCommand: `/receipt_confirm ${confirmation.token}`,
    rejectCommand: `/receipt_reject ${confirmation.token}`,
    methodCommands: confirmation.paymentMethodOptions.map((paymentMethod) => ({
      paymentMethod,
      command: `/receipt_method ${confirmation.token} ${paymentMethod}`,
      callbackData: `${CALLBACK_METHOD_PREFIX}${confirmation.token}:${paymentMethod}`
    })),
    confirmCallbackData: `${CALLBACK_CONFIRM_PREFIX}${confirmation.token}`,
    rejectCallbackData: `${CALLBACK_REJECT_PREFIX}${confirmation.token}`
  }));
}
