const subscriptionKeywords = [
  "spotify",
  "netflix",
  "youtube premium",
  "chatgpt",
  "icloud",
  "canva",
  "notion",
  "midjourney"
];

const mobilityKeywords = [
  "gojek",
  "grab ride",
  "bluebird",
  "transjakarta",
  "mrt",
  "krl",
  "toll",
  "parkir",
  "pertamina",
  "shell"
];

const groceriesKeywords = [
  "alfamart",
  "indomaret",
  "minimarket",
  "supermarket",
  "hypermart"
];

const foodKeywords = [
  "restaurant",
  "rumah makan",
  "kopi",
  "coffee",
  "cafe",
  "gofood",
  "grabfood",
  "shopeefood",
  "delivery order"
];

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function classifyReceipt(merchantName: string, rawText: string): ReceiptClassification {
  const normalized = `${merchantName} ${rawText}`.toLowerCase();

  if (hasAnyKeyword(normalized, subscriptionKeywords)) return "subscription";
  if (hasAnyKeyword(normalized, mobilityKeywords)) return "mobility";
  if (hasAnyKeyword(normalized, groceriesKeywords)) return "groceries";
  if (hasAnyKeyword(normalized, foodKeywords)) return "food";
  return "nonfood";
}

export type ReceiptClassification =
  | "food"
  | "mobility"
  | "groceries"
  | "nonfood"
  | "subscription";
