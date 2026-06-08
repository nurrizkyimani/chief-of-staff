export type SaveCalorieRowInput = {
  entryId: string;
  calories: number;
};

export type SaveCalorieRowResult = {
  status: "saved" | "duplicate" | "skipped" | "failed";
};
