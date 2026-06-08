export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown
  ) {
    super(message);
  }
}
