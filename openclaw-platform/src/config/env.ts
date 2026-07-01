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
  MISTRAL_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  MISTRAL_API_BASE: z.string().url().default("https://api.mistral.ai"),
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
  RECEIPT_PAYMENT_METHODS: z.string().default("cc-bca,db-bca,cc-bri,db-jago,db-cash,bca,cc-jenius,cash"),
  RECEIPT_PAYMENT_METHOD_ALIASES: z
    .string()
    .default(
      "cc-bca=cc bca|credit bca|kartu kredit bca;db-bca=db bca|debit bca;cc-bri=cc bri|credit bri;db-jago=db jago|debit jago|jago;db-cash=db cash|debit cash;cc-jenius=cc jeni|cc jenius;cash=cash|tunai"
    ),
  RECEIPT_PAYMENT_AMBIGUOUS_ALIASES: z.string().default("bca|edc bca|bank bca"),
  NODE_ENV: z.string().default("development"),
  OPENCLAW_HOME: z.string().optional(),
  OPENCLAW_MEMORY_VAULT_PATH: z.string().min(1).optional(),
  OPENCLAW_MEMORY_GIT_AUTO_COMMIT: BoolLikeSchema.default(false),
  OPENCLAW_MEMORY_GIT_AUTO_PUSH: BoolLikeSchema.default(false),
  WISHLIST_FILE_PATH: z.string().min(1).optional(),
  WISHLIST_ALLOWED_GROUPS: z.string().default("120363408773982912@g.us"),
  WISHLIST_EXACT_DISPATCH: BoolLikeSchema.default(true),
  WISHLIST_MODEL_CLASSIFIER: BoolLikeSchema.default(true),
  WISHLIST_MODEL_NAME: z.string().min(1).default("gemini-3.1-flash-lite"),
  TZ: z.string().default("Asia/Jakarta")
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

export const env = {
  ...parsed.data
};
