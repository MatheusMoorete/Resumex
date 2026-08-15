import { z } from 'zod';
import { BBoxSchema } from '../../schemas/documentIr.js';

export const AnnotationIntentEnum = z.enum([
  'comment',
  'correction',
  'question',
  'emphasis',
  'connector',
  'unknown',
]);

export type AnnotationIntent = z.infer<typeof AnnotationIntentEnum>;

export const HandwritingSegmentSchema = z.object({
  text: z.string().nullish().transform((v) => v ?? null),
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  alternatives: z.array(z.string()).default([]),
  bbox: BBoxSchema.nullish().transform((v) => v ?? null),
});

export type HandwritingSegment = z.infer<typeof HandwritingSegmentSchema>;

export const HandwritingTranscriptionSchema = z.object({
  transcription: z.string().nullish().transform((v) => v ?? null),
  segments: z.array(HandwritingSegmentSchema).default([]),
  annotationIntent: AnnotationIntentEnum.default('unknown'),
  language: z.string().default('por'),
  unreadable: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});

export type HandwritingTranscriptionOutput = z.infer<typeof HandwritingTranscriptionSchema>;
