import {
  extractReceiptFromImage,
  type ReceiptParseCandidate
} from "../../integrations/models/mistral-receipt-parser.adapter.js";
import type { ReceiptIntent } from "./build-receipt-payload.js";

export type ReadReceiptImageInput = {
  imageBase64: string;
  mimeType: string;
  intent: ReceiptIntent;
};

export type ReadReceiptImageResult = ReceiptParseCandidate;

export async function readReceiptImage(input: ReadReceiptImageInput): Promise<ReadReceiptImageResult> {
  return extractReceiptFromImage(input.imageBase64, input.mimeType, input.intent);
}
