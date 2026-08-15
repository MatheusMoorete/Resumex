import { describe, expect, it } from 'vitest';
import {
  BBoxSchema,
  ContentBlockSchema,
  DocumentIRSchema,
  DocumentPageSchema,
} from '../src/schemas/documentIr.js';
import { execFileSync } from 'node:child_process';

describe('Document IR Zod Schemas & Round-Trip Validation', () => {
  it('should validate a complete valid Document IR object', () => {
    const validDocIR = {
      schemaVersion: '1.0.0',
      documentId: 'doc-node-123',
      sourceHash: 'sha256-hash-sample',
      pageCount: 1,
      createdAt: new Date().toISOString(),
      extractorVersion: '1.0.0',
      pages: [
        {
          pageNumber: 1,
          width: 600,
          height: 800,
          rotation: 0,
          nativeTextCoverage: 0.8,
          rasterImageCoverage: 0.1,
          flags: ['has_handwriting'],
          processingPlan: {
            useNativeText: true,
            runPrintedOcr: false,
            runLayoutAnalysis: true,
            detectHandwriting: true,
            analyzeVisualRelations: true,
            useFullPageVision: false,
            visualRegions: [],
            reasons: [],
          },
          blocks: [
            {
              id: 'p1-heading-01-a1b2c3',
              pageNumber: 1,
              type: 'heading',
              semanticRole: 'title',
              text: 'Aspectos Históricos do SUS',
              bbox: { x0: 10, y0: 10, x1: 500, y1: 50, coordinateSpace: 'pdf_points' },
              source: 'pdf_native',
              confidence: 1.0,
              visualAttributes: {},
              relationships: [],
              checksum: 'chk-1',
              metadata: {},
            },
            {
              id: 'p1-handwriting-02-d4e5f6',
              pageNumber: 1,
              type: 'handwriting',
              semanticRole: 'body',
              text: 'SUS = resultado de um contexto',
              bbox: { x0: 12, y0: 60, x1: 300, y1: 90, coordinateSpace: 'pdf_points' },
              source: 'vision_model',
              confidence: 0.95,
              visualAttributes: { color: 'blue' },
              relationships: [
                {
                  type: 'comments_on',
                  targetBlockId: 'p1-heading-01-a1b2c3',
                  confidence: 0.9,
                },
              ],
              checksum: 'chk-2',
              metadata: {},
            },
          ],
          rasterReferences: [],
          warnings: [],
        },
      ],
      warnings: [],
    };

    const parsed = DocumentIRSchema.parse(validDocIR);
    expect(parsed.documentId).toBe('doc-node-123');
    expect(parsed.pages[0].blocks).toHaveLength(2);
  });

  it('should reject invalid BBox (x0 > x1)', () => {
    const invalidBBox = { x0: 100, y0: 10, x1: 50, y1: 50, coordinateSpace: 'pdf_points' };
    const res = BBoxSchema.safeParse(invalidBBox);
    expect(res.success).toBe(false);
  });

  it('should reject invalid confidence (> 1.0 or < 0.0)', () => {
    const invalidBlock = {
      id: 'p1-paragraph-01-xxxxxx',
      pageNumber: 1,
      type: 'paragraph',
      bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
      source: 'pdf_native',
      confidence: 1.5,
    };
    const res = ContentBlockSchema.safeParse(invalidBlock);
    expect(res.success).toBe(false);
  });

  it('should reject relationship pointing to non-existent targetBlockId', () => {
    const docWithBadRel = {
      schemaVersion: '1.0.0',
      documentId: 'doc-bad-rel',
      sourceHash: 'hash',
      pageCount: 1,
      createdAt: new Date().toISOString(),
      pages: [
        {
          pageNumber: 1,
          width: 500,
          height: 500,
          rotation: 0,
          blocks: [
            {
              id: 'p1-heading-01-a1b2c3',
              pageNumber: 1,
              type: 'heading',
              bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
              source: 'pdf_native',
              relationships: [
                {
                  type: 'comments_on',
                  targetBlockId: 'p1-missing-id',
                  confidence: 0.9,
                },
              ],
            },
          ],
        },
      ],
    };
    const res = DocumentIRSchema.safeParse(docWithBadRel);
    expect(res.success).toBe(false);
  });

  it('should reject incompatible schemaVersion (e.g. 2.0.0)', () => {
    const docWithIncompatibleVersion = {
      schemaVersion: '2.0.0',
      documentId: 'doc-v2',
      sourceHash: 'hash',
      pageCount: 0,
      createdAt: new Date().toISOString(),
      pages: [],
    };
    const res = DocumentIRSchema.safeParse(docWithIncompatibleVersion);
    expect(res.success).toBe(false);
  });

  it('should validate documents without pages', () => {
    const emptyDoc = {
      schemaVersion: '1.0.0',
      documentId: 'doc-empty',
      sourceHash: 'hash',
      pageCount: 0,
      createdAt: new Date().toISOString(),
      pages: [],
    };
    const parsed = DocumentIRSchema.parse(emptyDoc);
    expect(parsed.pageCount).toBe(0);
    expect(parsed.pages).toHaveLength(0);
  });

  it('should validate pages without blocks', () => {
    const emptyPageDoc = {
      schemaVersion: '1.0.0',
      documentId: 'doc-empty-page',
      sourceHash: 'hash',
      pageCount: 1,
      createdAt: new Date().toISOString(),
      pages: [
        {
          pageNumber: 1,
          width: 500,
          height: 500,
          rotation: 0,
          blocks: [],
        },
      ],
    };
    const parsed = DocumentIRSchema.parse(emptyPageDoc);
    expect(parsed.pages[0].blocks).toHaveLength(0);
  });

  it('should perform JSON Round-Trip between Python output and Node Zod Schema', () => {
    const pyScript = `
import json
from worker.document_ir import DocumentIR, DocumentPage, ContentBlock, BBox, BlockType, SemanticRole, ContentSource

block = ContentBlock(
    id="p1-native_text-01-a1b2c3",
    pageNumber=1,
    type=BlockType.NATIVE_TEXT,
    semanticRole=SemanticRole.BODY,
    text="Test Python Round-Trip",
    bbox=BBox(x0=10, y0=10, x1=100, y1=50),
    source=ContentSource.PDF_NATIVE,
    confidence=0.98
)
page = DocumentPage(pageNumber=1, width=600, height=800, blocks=[block])
doc = DocumentIR(
    documentId="doc-py-rt",
    sourceHash="hash-py-rt",
    pageCount=1,
    createdAt="2026-07-24T15:00:00Z",
    pages=[page]
)
print(doc.model_dump_json())
`;

    const pythonBin = process.platform === 'win32' ? 'py' : 'python3';
    const jsonOutput = execFileSync(pythonBin, ['-c', pyScript], { encoding: 'utf-8' });
    const rawObj = JSON.parse(jsonOutput);

    const parsed = DocumentIRSchema.parse(rawObj);
    expect(parsed.documentId).toBe('doc-py-rt');
    expect(parsed.pages[0].blocks[0].text).toBe('Test Python Round-Trip');
    expect(parsed.pages[0].blocks[0].confidence).toBe(0.98);
  }, 15_000);
});
