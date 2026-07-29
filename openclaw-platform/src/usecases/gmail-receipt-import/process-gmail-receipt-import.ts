import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import type { GmailReceiptAttachment, GmailReceiptSource } from "../../integrations/gmail/gmail-receipt-source.js";
import type { ReceiptConfirmationRequest } from "../receipt-assistant/queue-receipt-confirmation.js";
import type { ProcessReceiptAssistantInput, ProcessReceiptAssistantResult } from "../receipt-assistant/process-receipt-assistant.types.js";

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

export type GmailReceiptImportInput = {
  account: string;
  label: string;
  lookbackMinutes: number;
  maxMessages: number;
  maxPdfPages: number;
  source: GmailReceiptSource;
  now?: Date;
  savedReceiptIds: Set<string>;
  pendingReceiptIds: Set<string>;
  processReceipt?: (
    input: ProcessReceiptAssistantInput
  ) => Promise<ProcessReceiptAssistantResult>;
};

export type GmailReceiptImportResult = {
  message: string;
  confirmations: ReceiptConfirmationRequest[];
};

export async function processGmailReceiptImport(
  input: GmailReceiptImportInput
): Promise<GmailReceiptImportResult> {
  const now = input.now ?? new Date();
  const afterSeconds = Math.floor(
    (now.getTime() - input.lookbackMinutes * 60 * 1000) / 1000
  );
  const query = `label:${quoteGmailQueryValue(input.label)} has:attachment after:${afterSeconds}`;
  const attachments = await input.source.searchAttachments({
    account: input.account,
    query,
    maxMessages: input.maxMessages
  });
  const supported = attachments.filter((attachment) =>
    SUPPORTED_MIME_TYPES.has(attachment.mimeType)
  );
  const confirmations: ReceiptConfirmationRequest[] = [];
  const errors: string[] = [];
  let saved = 0;
  let waiting = 0;
  let queued = 0;

  for (const attachment of supported) {
    const receiptIds = candidateReceiptIds(input.account, attachment, input.maxPdfPages);
    if (receiptIds.some((receiptId) => input.savedReceiptIds.has(receiptId))) {
      saved += 1;
      continue;
    }
    if (receiptIds.some((receiptId) => input.pendingReceiptIds.has(receiptId))) {
      waiting += 1;
      continue;
    }

    try {
      const result = await processAttachment(input, attachment);
      confirmations.push(...result.confirmations);
      errors.push(...result.messages);
      if (result.confirmations.length > 0) queued += 1;
    } catch (error) {
      errors.push(`${attachment.filename}: ${errorMessage(error)}`);
    }
  }

  return {
    confirmations,
    message: formatSummary({
      found: supported.length,
      queued,
      saved,
      waiting,
      unsupported: attachments.length - supported.length,
      errors
    })
  };
}

async function processAttachment(
  input: GmailReceiptImportInput,
  attachment: GmailReceiptAttachment
) {
  const directory = await mkdtemp(join(tmpdir(), "openclaw-gmail-receipt-"));
  const extension = safeExtension(attachment);
  const path = join(directory, `receipt${extension}`);

  try {
    const binary = await input.source.downloadAttachment({
      account: input.account,
      messageId: attachment.messageId,
      attachmentId: attachment.attachmentId
    });
    await writeFile(path, binary);

    const processReceipt =
      input.processReceipt ??
      (await import("../receipt-assistant/process-receipt-assistant.js")).processReceiptAssistant;
    return processReceipt({
      sourcePlatform: "gmail",
      chatId: `gmail:${input.account.toLowerCase()}`,
      baseMessageId: stableBaseMessageId(attachment),
      receivedAt: attachment.receivedAt,
      captionText: `Gmail attachment: ${attachment.filename}`,
      mediaCandidates: [{ url: path, mimeType: attachment.mimeType }],
      intent: "receipt",
      intentSource: "gmail_import"
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function candidateReceiptIds(
  account: string,
  attachment: GmailReceiptAttachment,
  maxPdfPages: number
): string[] {
  const prefix = `gmail:${account.toLowerCase()}:${stableBaseMessageId(attachment)}`;
  if (attachment.mimeType !== "application/pdf") return [prefix];
  return [
    prefix,
    ...Array.from({ length: maxPdfPages }, (_, index) => `${prefix}:m1:p${index + 1}`)
  ];
}

export function stableBaseMessageId(attachment: GmailReceiptAttachment): string {
  const digest = createHash("sha256").update(attachment.attachmentId).digest("hex").slice(0, 16);
  return `${attachment.messageId}:${digest}`;
}

function quoteGmailQueryValue(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

function safeExtension(attachment: GmailReceiptAttachment): string {
  const fromFilename = extname(attachment.filename).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromFilename)) return fromFilename;
  if (attachment.mimeType === "application/pdf") return ".pdf";
  if (attachment.mimeType === "image/png") return ".png";
  if (attachment.mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function formatSummary(input: {
  found: number;
  queued: number;
  saved: number;
  waiting: number;
  unsupported: number;
  errors: string[];
}): string {
  const lines = [
    "Gmail receipt scan:",
    `Found: ${input.found}`,
    `Queued for confirmation: ${input.queued}`,
    `Already saved: ${input.saved}`,
    `Already waiting: ${input.waiting}`
  ];
  if (input.unsupported > 0) lines.push(`Unsupported attachments: ${input.unsupported}`);
  if (input.errors.length > 0) {
    lines.push(`Errors: ${input.errors.length}`);
    lines.push(...input.errors.slice(0, 3));
  }
  return lines.join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
