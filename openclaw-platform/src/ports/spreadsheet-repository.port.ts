export type SpreadsheetAppendResult = "appended" | "duplicate" | "skipped";

export type SpreadsheetRepositoryPort<TRow> = {
  append(row: TRow): Promise<SpreadsheetAppendResult>;
};
