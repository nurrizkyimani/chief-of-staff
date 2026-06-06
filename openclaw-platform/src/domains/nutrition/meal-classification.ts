export const mealClassifications = ["meal", "snack", "drink", "supplement", "unknown"] as const;

export type MealClassification = (typeof mealClassifications)[number];
