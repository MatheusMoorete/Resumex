import { z } from 'zod';

export const notionExportSchema = z.object({
  markdown: z.string().min(1, 'Resumo vazio.'),
  title: z.string().optional(),
});

export type NotionExportPayload = z.infer<typeof notionExportSchema>;
