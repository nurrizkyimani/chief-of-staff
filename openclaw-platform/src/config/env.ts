import "dotenv/config";
import { z } from "zod";

const BoolLikeSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  MISTRAL_API_KEY: z.string().min(1),
  MISTRAL_API_BASE: z.string().url().default("https://api.mistral.ai"),
  RECEIPT_MODEL: z.string().default("mistral-small-latest"),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_API_BASE: z.string().url().default("https://api.telegram.org"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1),
  RECEIPT_SPREADSHEET_ID: z.string().min(1),
  RECEIPT_SHEET_RAW: z.string().default("receipts_raw"),
  RECEIPT_SHEET_MONTHLY: z.string().default("monthly_breakdown"),
  RECEIPT_MAX_PDF_PAGES: z.coerce.number().int().min(1).max(10).default(3),
  RECEIPT_ACCEPT_PDF: BoolLikeSchema.default(false),
  RECEIPT_STRICT_MEMORY_ONLY: BoolLikeSchema.default(false),
  RECEIPT_JOURNAL_PATH: z.string().min(1),
  RECEIPT_SAVE_JOURNAL: BoolLikeSchema.default(true),
  RECEIPT_SAVE_SHEETS: BoolLikeSchema.default(true),
  RECEIPT_CONFIRMATION_TTL_MS: z.coerce.number().int().min(1).default(30 * 60 * 1000),
  NODE_ENV: z.string().default("development"),
  OPENCLAW_HOME: z.string().optional(),
  TZ: z.string().default("Asia/Jakarta")
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

export const env = {
  ...parsed.data
};
