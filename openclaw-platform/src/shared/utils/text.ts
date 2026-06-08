export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
