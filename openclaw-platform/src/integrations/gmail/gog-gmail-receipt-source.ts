import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  GmailReceiptAttachment,
  GmailReceiptSearchInput,
  GmailReceiptSource
} from "./gmail-receipt-source.js";

const execFileAsync = promisify(execFile);

type GogRunner = (args: string[]) => Promise<unknown>;

export type GogGmailReceiptSourceOptions = {
  binary: string;
  runner?: GogRunner;
};

export class GogGmailReceiptSource implements GmailReceiptSource {
  private readonly run: GogRunner;

  constructor(options: GogGmailReceiptSourceOptions) {
    this.run = options.runner ?? createGogRunner(options.binary);
  }

  async searchAttachments(input: GmailReceiptSearchInput): Promise<GmailReceiptAttachment[]> {
    const searchResult = await this.run([
      ...globalGogArgs(input.account),
      "gmail",
      "messages",
      "search",
      input.query,
      "--max",
      String(input.maxMessages)
    ]);
    const messageIds = extractMessageIds(searchResult);
    const attachments: GmailReceiptAttachment[] = [];

    for (const messageId of messageIds) {
      const message = await this.run([
        ...globalGogArgs(input.account),
        "gmail",
        "get",
        messageId,
        "--format",
        "full"
      ]);
      attachments.push(...extractAttachments(messageId, message));
    }

    return attachments;
  }

  async downloadAttachment(input: {
    account: string;
    messageId: string;
    attachmentId: string;
  }): Promise<Buffer> {
    const result = await this.run([
      ...globalGogArgs(input.account),
      "gmail",
      "attachment",
      input.messageId,
      input.attachmentId,
      "--inline"
    ]);
    const contentBase64 = findString(result, "contentBase64");
    if (contentBase64) return Buffer.from(contentBase64, "base64");

    const path = findString(result, "path") ?? findString(result, "filePath");
    if (path) return readFile(path);

    throw new Error("gog did not return Gmail attachment content.");
  }
}

function globalGogArgs(account: string): string[] {
  return [
    "--account",
    account,
    "--readonly",
    "--gmail-no-send",
    "--no-input",
    "--json",
    "--results-only"
  ];
}

function createGogRunner(binary: string): GogRunner {
  return async (args) => {
    try {
      const result = await execFileAsync(binary, args, {
        encoding: "utf8",
        maxBuffer: 25 * 1024 * 1024,
        env: process.env
      });
      return JSON.parse(result.stdout);
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new Error(`Gmail receipt import requires the gog CLI at: ${binary}`);
      }
      throw error;
    }
  };
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function extractMessageIds(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : findArray(value, ["messages", "results", "items"]);
  const ids = candidates
    .map((item) => findString(item, "id") ?? findString(item, "messageId"))
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

function extractAttachments(messageId: string, message: unknown): GmailReceiptAttachment[] {
  const receivedAt = findReceivedAt(message);
  const attachments: GmailReceiptAttachment[] = [];

  visitObjects(message, (candidate) => {
    const body =
      typeof candidate.body === "object" && candidate.body !== null
        ? (candidate.body as Record<string, unknown>)
        : undefined;
    const attachmentId =
      directString(candidate, "attachmentId") ??
      (body ? directString(body, "attachmentId") : undefined);
    const filename = directString(candidate, "filename");
    const mimeType = directString(candidate, "mimeType");
    if (!attachmentId || !filename || !mimeType) return;

    attachments.push({
      messageId,
      attachmentId,
      filename,
      mimeType: mimeType.toLowerCase(),
      receivedAt
    });
  });

  return dedupeAttachments(attachments);
}

function dedupeAttachments(attachments: GmailReceiptAttachment[]): GmailReceiptAttachment[] {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const key = `${attachment.messageId}:${attachment.attachmentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findReceivedAt(message: unknown): string {
  const raw =
    findString(message, "internalDate") ??
    findString(message, "receivedAt") ??
    findString(message, "date");
  if (!raw) return new Date().toISOString();

  const numeric = Number(raw);
  const parsed = Number.isFinite(numeric) ? new Date(numeric) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function findArray(value: unknown, keys: string[]): unknown[] {
  if (typeof value !== "object" || value === null) return [];
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function findString(value: unknown, key: string): string | undefined {
  let result: string | undefined;
  visitObjects(value, (candidate) => {
    if (result) return;
    result = directString(candidate, key);
  });
  return result;
}

function directString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function visitObjects(
  value: unknown,
  visitor: (candidate: Record<string, unknown>) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitObjects(item, visitor));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const candidate = value as Record<string, unknown>;
  visitor(candidate);
  Object.values(candidate).forEach((item) => visitObjects(item, visitor));
}
