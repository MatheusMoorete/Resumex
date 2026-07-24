import { z } from 'zod';

export const aiChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.any())]),
  name: z.string().optional(),
});

export const aiCompletionRequestSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  messages: z.array(aiChatMessageSchema).min(1, 'Messages array cannot be empty'),
  max_tokens: z.number().optional(),
  max_completion_tokens: z.number().optional(),
  temperature: z.number().optional(),
  stream: z.boolean().optional(),
}).passthrough();

export type AiChatMessage = z.infer<typeof aiChatMessageSchema>;
export type AiCompletionRequest = z.infer<typeof aiCompletionRequestSchema>;
