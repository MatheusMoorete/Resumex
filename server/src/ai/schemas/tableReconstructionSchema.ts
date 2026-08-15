import { z } from 'zod';

export const TableReconstructionSchema = z.object({
  title: z.string().nullish().transform((v) => v ?? null),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.array(z.string())).default([]),
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  tableStructureUncertain: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});

export type TableReconstructionOutput = z.infer<typeof TableReconstructionSchema>;
