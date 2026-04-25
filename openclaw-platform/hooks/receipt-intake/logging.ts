import { LOG_PREFIX, LOG_PREVIEW_MAX, WHITESPACE_SEQUENCE_PATTERN } from "./constants.ts";

// safeJson serializes values for logging without throwing.
export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// preview formats a compact log-safe version of a value.
export function preview(value: unknown, max = LOG_PREVIEW_MAX): string {
  if (value === undefined) return "(undefined)";
  if (value === null) return "(null)";

  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    text = String(value);
  } else {
    text = safeJson(value);
  }

  const normalized = text.replace(WHITESPACE_SEQUENCE_PATTERN, " ").trim();
  if (!normalized) return "(empty)";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

// logStep writes a structured receipt-intake log line.
export function logStep(step: string, data?: Record<string, unknown>): void {
  if (!data) {
    console.info(`${LOG_PREFIX} ${step}`);
    return;
  }
  console.info(`${LOG_PREFIX} ${step} ${safeJson(data)}`);
}

// describeMessageShape summarizes the event message array shape.
export function describeMessageShape(messages: unknown[]): string[] {
  return messages.slice(0, 12).map((item) => {
    if (item === null) return "null";
    if (Array.isArray(item)) return "array";
    if (typeof item === "object") {
      const keys = Object.keys(item as Record<string, unknown>).slice(0, 4);
      return keys.length > 0 ? `object{${keys.join(",")}}` : "object{}";
    }
    return typeof item;
  });
}
