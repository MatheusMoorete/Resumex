import { z } from 'zod';

export const SectionPlanSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().default(''),
  sourceBlockIds: z.array(z.string()).default([]),
  sourcePages: z.array(z.number().int()).default([]),
  priority: z.number().int().default(1),
  estimatedTokens: z.number().int().default(1000),
});

export type SectionPlan = z.infer<typeof SectionPlanSchema>;

export const SummaryPlanSchema = z.object({
  title: z.string().min(1).default('Plano de Resumo Médico'),
  sections: z.array(SectionPlanSchema).min(1, 'Pelo menos uma seção deve ser planejada'),
  uncoveredBlockIds: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type SummaryPlanOutput = z.infer<typeof SummaryPlanSchema>;
