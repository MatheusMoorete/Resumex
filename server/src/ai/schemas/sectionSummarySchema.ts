import { z } from 'zod';

export const ClaimItemSchema = z.object({
  claimId: z.string().min(1),
  text: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
  confidence: z.number().min(0.0).max(1.0).default(1.0),
});

export type ClaimItem = z.infer<typeof ClaimItemSchema>;

export const SectionSummarySchema = z.object({
  sectionKey: z.string().min(1),
  markdown: z.string().min(1),
  claims: z.array(ClaimItemSchema).default([]),
  unusedBlockIds: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type SectionSummaryOutput = z.infer<typeof SectionSummarySchema>;
