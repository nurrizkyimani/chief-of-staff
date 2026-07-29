import assert from "node:assert/strict";
import { GogGmailReceiptSource } from "../integrations/gmail/gog-gmail-receipt-source.js";
import type {
  GmailReceiptAttachment,
  GmailReceiptSource
} from "../integrations/gmail/gmail-receipt-source.js";
import { detectTaskTrigger } from "../task-router/task-trigger.detector.js";
import {
  candidateReceiptIds,
  processGmailReceiptImport
} from "../usecases/gmail-receipt-import/process-gmail-receipt-import.js";

assert.deepEqual(detectTaskTrigger("/parse", false), {
  kind: "gmail-receipt-import",
  source: "gmail_parse_command"
});
assert.deepEqual(detectTaskTrigger("/parse@imnfinancebot", false), {
  kind: "gmail-receipt-import",
  source: "gmail_parse_command"
});

const gogCalls: string[][] = [];
const gogSource = new GogGmailReceiptSource({
  binary: "gog",
  runner: async (args) => {
    gogCalls.push(args);
    if (args.includes("search")) {
      return [{ id: "message-1" }];
    }
    if (args.includes("get")) {
      return {
        internalDate: "1782864000000",
        payload: {
          parts: [
            {
              filename: "receipt.jpg",
              mimeType: "image/jpeg",
              body: { attachmentId: "attachment-1" }
            }
          ]
        }
      };
    }
    return { contentBase64: Buffer.from("receipt bytes").toString("base64") };
  }
});

const gogAttachments = await gogSource.searchAttachments({
  account: "finance@example.com",
  query: "label:test has:attachment",
  maxMessages: 20
});
assert.deepEqual(gogAttachments, [
  {
    messageId: "message-1",
    attachmentId: "attachment-1",
    filename: "receipt.jpg",
    mimeType: "image/jpeg",
    receivedAt: "2026-07-01T00:00:00.000Z"
  }
]);
assert.ok(gogCalls[0]?.includes("--readonly"));
assert.ok(gogCalls[0]?.includes("--gmail-no-send"));
assert.ok(gogCalls[0]?.includes("--no-input"));
assert.equal(
  (await gogSource.downloadAttachment({
    account: "finance@example.com",
    messageId: "message-1",
    attachmentId: "attachment-1"
  })).toString(),
  "receipt bytes"
);

const attachments: GmailReceiptAttachment[] = [
  makeAttachment("saved-message", "saved-attachment", "saved.jpg", "image/jpeg"),
  makeAttachment("pending-message", "pending-attachment", "pending.jpg", "image/jpeg"),
  makeAttachment("new-message", "new-attachment", "new.jpg", "image/jpeg"),
  makeAttachment("ignored-message", "ignored-attachment", "ignored.txt", "text/plain")
];
const searchInputs: Array<{ query: string; maxMessages: number }> = [];
const downloaded: string[] = [];
const source: GmailReceiptSource = {
  async searchAttachments(input) {
    searchInputs.push({ query: input.query, maxMessages: input.maxMessages });
    return attachments;
  },
  async downloadAttachment(input) {
    downloaded.push(input.attachmentId);
    return Buffer.from("image");
  }
};
const savedId = candidateReceiptIds("finance@example.com", attachments[0]!, 3)[0]!;
const pendingId = candidateReceiptIds("finance@example.com", attachments[1]!, 3)[0]!;
let processedReceiptId = "";

const result = await processGmailReceiptImport({
  account: "finance@example.com",
  label: "OpenClaw/Receipt",
  lookbackMinutes: 30,
  maxMessages: 20,
  maxPdfPages: 3,
  source,
  now: new Date("2026-07-01T00:30:00.000Z"),
  savedReceiptIds: new Set([savedId]),
  pendingReceiptIds: new Set([pendingId]),
  async processReceipt(input) {
    processedReceiptId = `${input.chatId}:${input.baseMessageId}`;
    return {
      handled: true,
      messages: [],
      confirmations: [
        {
          token: "token",
          previewText: "preview",
          mediaIndex: 0,
          totalMedia: 1,
          pageNumber: 1,
          totalPages: 1,
          paymentMethod: "",
          paymentMethodOptions: ["cash"]
        }
      ]
    };
  }
});

assert.equal(
  searchInputs[0]?.query,
  'label:"OpenClaw/Receipt" has:attachment after:1782864000'
);
assert.equal(searchInputs[0]?.maxMessages, 20);
assert.deepEqual(downloaded, ["new-attachment"]);
assert.equal(
  processedReceiptId,
  candidateReceiptIds("finance@example.com", attachments[2]!, 3)[0]
);
assert.equal(result.confirmations.length, 1);
assert.equal(
  result.message,
  [
    "Gmail receipt scan:",
    "Found: 3",
    "Queued for confirmation: 1",
    "Already saved: 1",
    "Already waiting: 1",
    "Unsupported attachments: 1"
  ].join("\n")
);

function makeAttachment(
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string
): GmailReceiptAttachment {
  return {
    messageId,
    attachmentId,
    filename,
    mimeType,
    receivedAt: "2026-07-01T00:15:00.000Z"
  };
}

console.log("gmail receipt import tests passed");
