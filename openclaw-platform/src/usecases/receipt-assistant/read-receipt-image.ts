import {
  extractReceiptFromImage,
  type ReceiptParseCandidate
} from "../../integrations/models/mistral-receipt-parser.adapter.js";
import { getReceiptModelConfig } from "../../config/providers.js";
import { parseReceiptImageWithGemini } from "../../integrations/models/gemini-vision.adapter.js";
import type { ReceiptIntent } from "./build-receipt-payload.js";

export type ReadReceiptImageInput = {
  imageBase64: string;
  mimeType: string;
  intent: ReceiptIntent;
};

export type ReadReceiptImageResult = ReceiptParseCandidate;

export async function readReceiptImage(input: ReadReceiptImageInput): Promise<ReadReceiptImageResult> {
  const receiptModel = getReceiptModelConfig();

  if (receiptModel.provider === "google") {
    return parseReceiptImageWithGemini(input.imageBase64, input.mimeType, input.intent, receiptModel.model);
  }

  return extractReceiptFromImage(input.imageBase64, input.mimeType, input.intent, receiptModel.model);
}
