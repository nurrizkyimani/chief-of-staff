import { ReceiptPayloadSchema, type ReceiptPayload } from "../schemas/receipt.v1.1.schema.js";

export function validateReceiptV11(payload: unknown): ReceiptPayload {
  return ReceiptPayloadSchema.parse(payload);
}
