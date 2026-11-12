import { z } from "zod";

export const notebookDetailsSchema = z.object({
  title: z.string().trim().min(3, "Use at least 3 characters.").max(80, "Keep the title under 80 characters."),
  description: z.string().trim().max(160, "Keep the description under 160 characters."),
});

export const notebookIdSchema = z.uuid();

