import { z } from 'zod';
import { ClaimItemSchema } from './sectionSummarySchema.js';

export const RepairSectionSchema = z.object({
  sectionKey: z.string().min(1),
  markdown: z.string().min(1),
  claims: z.array(ClaimItemSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export type RepairSectionOutput = z.infer<typeof RepairSectionSchema>;
