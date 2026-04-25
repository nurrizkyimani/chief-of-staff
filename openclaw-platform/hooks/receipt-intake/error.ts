// errorReason returns a stable string reason for logging failures.
export function errorReason(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}:${error.message}`;
  }
  return error instanceof Error ? error.message : "unknown_error";
}
