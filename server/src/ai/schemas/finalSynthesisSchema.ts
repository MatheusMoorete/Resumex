import { z } from 'zod';

export const FinalSynthesisSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
  sectionKeys: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type FinalSynthesisOutput = z.infer<typeof FinalSynthesisSchema>;
