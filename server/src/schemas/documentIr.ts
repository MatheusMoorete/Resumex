import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';

export const BlockTypeEnum = z.enum([
  'native_text',
  'printed_ocr',
  'handwriting',
  'heading',
  'paragraph',
  'list_item',
  'table',
  'table_row',
  'table_cell',
  'image',
  'image_caption',
  'diagram',
  'chart',
  'highlight',
  'underline',
  'strikeout',
  'arrow',
  'callout',
  'annotation',
  'decorative',
]);

export type BlockType = z.infer<typeof BlockTypeEnum>;

export const SemanticRoleEnum = z.enum([
  'title',
  'subtitle',
  'body',
  'definition',
  'example',
  'warning',
  'exam_tip',
  'caption',
  'footnote',
  'table_header',
  'table_value',
  'unknown',
]);

export type SemanticRole = z.infer<typeof SemanticRoleEnum>;

export const ContentSourceEnum = z.enum([
  'pdf_native',
  'pdf_annotation',
  'pdf_vector',
  'pdf_embedded_image',
  'local_ocr',
  'cloud_ocr',
  'vision_model',
  'user_correction',
]);

export type ContentSource = z.infer<typeof ContentSourceEnum>;

export const RelationshipTypeEnum = z.enum([
  'comments_on',
  'points_to',
  'highlights',
  'corrects',
  'contradicts',
  'labels',
  'caption_of',
  'continuation_of',
  'belongs_to_table',
  'belongs_to_section',
]);

export type RelationshipType = z.infer<typeof RelationshipTypeEnum>;

export const BBoxSchema = z
  .object({
    x0: z.number().finite(),
    y0: z.number().finite(),
    x1: z.number().finite(),
    y1: z.number().finite(),
    coordinateSpace: z.literal('pdf_points').default('pdf_points'),
  })
  .refine((val) => val.x0 <= val.x1, {
    message: 'x0 não pode ser maior que x1',
    path: ['x0'],
  })
  .refine((val) => val.y0 <= val.y1, {
    message: 'y0 não pode ser maior que y1',
    path: ['y0'],
  });

export type BBox = z.infer<typeof BBoxSchema>;

export const BlockRelationshipSchema = z.object({
  type: RelationshipTypeEnum,
  targetBlockId: z.string().min(1),
  confidence: z.number().min(0.0).max(1.0),
  metadata: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
});

export type BlockRelationship = z.infer<typeof BlockRelationshipSchema>;

export const ContentBlockSchema = z.object({
  id: z.string().min(1),
  pageNumber: z.number().int().min(1),
  type: BlockTypeEnum,
  semanticRole: SemanticRoleEnum.default('unknown'),
  text: z.string().default(''),
  bbox: BBoxSchema,
  polygon: z.array(z.object({ x: z.number(), y: z.number() })).nullish().transform((v) => v ?? undefined),
  readingOrder: z.number().int().min(0).default(0),
  source: ContentSourceEnum,
  confidence: z.number().min(0.0).max(1.0).default(1.0),
  language: z.string().nullish().transform((v) => v ?? undefined),
  visualAttributes: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  relationships: z.array(BlockRelationshipSchema).default([]),
  checksum: z.string().default(''),
  metadata: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
});

export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const RasterReferenceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  format: z.string().default('jpeg'),
  pageNumber: z.number().int().min(1),
  bbox: BBoxSchema.nullish().transform((v) => v ?? undefined),
});

export type RasterReference = z.infer<typeof RasterReferenceSchema>;

export const VisualRegionSchema = z.object({
  bbox: BBoxSchema,
  reason: z.string(),
});

export type VisualRegion = z.infer<typeof VisualRegionSchema>;

export const ProcessingPlanSchema = z.object({
  useNativeText: z.boolean().default(true),
  runPrintedOcr: z.boolean().default(false),
  runLayoutAnalysis: z.boolean().default(true),
  detectHandwriting: z.boolean().default(true),
  analyzeVisualRelations: z.boolean().default(true),
  useFullPageVision: z.boolean().default(false),
  visualRegions: z.array(VisualRegionSchema).default([]),
  reasons: z.array(z.string()).default([]),
});

export type ProcessingPlan = z.infer<typeof ProcessingPlanSchema>;

export const DocumentPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.enum(['0', '90', '180', '270']).or(z.literal(0)).or(z.literal(90)).or(z.literal(180)).or(z.literal(270)).transform((val) => Number(val)),
  nativeTextCoverage: z.number().min(0.0).max(1.0).default(0.0),
  rasterImageCoverage: z.number().min(0.0).max(1.0).default(0.0),
  flags: z.array(z.string()).default([]),
  processingPlan: ProcessingPlanSchema.default({
    useNativeText: true,
    runPrintedOcr: false,
    runLayoutAnalysis: true,
    detectHandwriting: true,
    analyzeVisualRelations: true,
    useFullPageVision: false,
    visualRegions: [],
    reasons: [],
  }),
  blocks: z.array(ContentBlockSchema).default([]),
  rasterReferences: z.array(RasterReferenceSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export type DocumentPage = z.infer<typeof DocumentPageSchema>;

export const DocumentIRSchema = z
  .object({
    schemaVersion: z.string().refine((val) => val.startsWith('1.'), {
      message: 'Incompatible schemaVersion. Expected 1.x.x',
    }),
    documentId: z.string().min(1),
    sourceHash: z.string().min(1),
    pageCount: z.number().int().min(0),
    createdAt: z.string(),
    extractorVersion: z.string().default('1.0.0'),
    pages: z.array(DocumentPageSchema).default([]),
    warnings: z.array(z.string()).default([]),
  })
  .refine((val) => val.pages.length === val.pageCount, {
    message: 'pageCount não corresponde à quantidade de páginas fornecida.',
    path: ['pageCount'],
  })
  .refine(
    (doc) => {
      const allBlockIds = new Set<string>();
      for (const page of doc.pages) {
        for (const block of page.blocks) {
          allBlockIds.add(block.id);
        }
      }
      for (const page of doc.pages) {
        for (const block of page.blocks) {
          for (const rel of block.relationships) {
            if (!allBlockIds.has(rel.targetBlockId)) {
              return false;
            }
          }
        }
      }
      return true;
    },
    {
      message: 'Relacionamento aponta para targetBlockId inexistente no documento.',
      path: ['pages'],
    }
  );

export type DocumentIR = z.infer<typeof DocumentIRSchema>;
