import { z } from "zod";

export const CalorieEntrySchema = z.object({
  entry_id: z.string().min(1),
  source_message_id: z.string().min(1),
  entry_date: z.string().min(1),
  calories: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  raw_json: z.record(z.any()).default({})
});

export type CalorieEntry = z.infer<typeof CalorieEntrySchema>;
