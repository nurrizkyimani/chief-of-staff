import assert from "node:assert/strict";
import { detectTaskTrigger } from "../task-router/task-trigger.detector.js";
import { selectReceiptMediaCandidates } from "../usecases/receipt-assistant/select-receipt-media.js";

const pdfOnly = {
  hasMedia: true,
  hasPdf: true,
  hasImage: false
};
const imageOnly = {
  hasMedia: true,
  hasPdf: false,
  hasImage: true
};
const mixedImageAndPdf = {
  hasMedia: true,
  hasPdf: true,
  hasImage: true
};

assert.deepEqual(detectTaskTrigger("", pdfOnly), {
  kind: "unhandled"
});
assert.deepEqual(detectTaskTrigger("/receipt", pdfOnly), {
  kind: "receipt-assistant",
  intent: "receipt",
  source: "receipt_command"
});
assert.deepEqual(detectTaskTrigger("", imageOnly), {
  kind: "receipt-assistant",
  intent: "receipt",
  source: "media_default"
});
assert.deepEqual(detectTaskTrigger("", mixedImageAndPdf), {
  kind: "receipt-assistant",
  intent: "receipt",
  source: "media_default"
});

const selected = selectReceiptMediaCandidates([
  { url: "receipt.jpg", mimeType: "image/jpeg", sourceId: "img" },
  { url: "statement.pdf", mimeType: "application/pdf", sourceId: "pdf" }
]);

assert.deepEqual(
  selected.candidates.map((candidate) => candidate.sourceId),
  ["img", "pdf"]
);
assert.equal(selected.skippedPdfCount, 0);

console.log("receipt pdf routing tests passed");
