import { z } from 'zod';
import { RelationshipTypeEnum } from '../../schemas/documentIr.js';

export const VisualRelationItemSchema = z.object({
  sourceRegionId: z.string().min(1),
  targetBlockId: z.string().min(1),
  type: RelationshipTypeEnum,
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  explanation: z.string().default(''),
});

export type VisualRelationItem = z.infer<typeof VisualRelationItemSchema>;

export const VisualRelationsSchema = z.object({
  relations: z.array(VisualRelationItemSchema).default([]),
  orphanAnnotation: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});

export type VisualRelationsOutput = z.infer<typeof VisualRelationsSchema>;
