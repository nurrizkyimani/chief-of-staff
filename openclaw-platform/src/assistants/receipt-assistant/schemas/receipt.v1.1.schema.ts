import { z } from "zod";

export const ReceiptPayloadSchema = z.object({
  schema_version: z.literal("receipt.v1.1"),
  receipt_id: z.string().min(1),
  source: z.object({
    platform: z.literal("telegram"),
    chat_id: z.string().min(1),
    message_id: z.string().min(1),
    received_at: z.string().min(1)
  }),
  merchant_name: z.string().min(1),
  receipt_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total_amount: z.number(),
  tax_amount: z.number(),
  tax_label_raw: z.string().default(""),
  classification: z.enum([
    "food",
    "mobility",
    "groceries",
    "nonfood",
    "subscription"
  ]),
  currency: z.string().default("IDR"),
  month_key: z.string().regex(/^\d{4}-\d{2}$/),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
  raw_json: z.record(z.any()).default({})
});

export type ReceiptPayload = z.infer<typeof ReceiptPayloadSchema>;
