import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIRouter } from '../src/ai/router.js';
import { HandwritingTranscriptionSchema } from '../src/ai/schemas/handwritingSchema.js';
import { VisualRelationsSchema } from '../src/ai/schemas/visualRelationsSchema.js';
import { TableReconstructionSchema } from '../src/ai/schemas/tableReconstructionSchema.js';
import { SummaryPlanSchema } from '../src/ai/schemas/summaryPlanSchema.js';
import { SectionSummarySchema } from '../src/ai/schemas/sectionSummarySchema.js';
import { FinalSynthesisSchema } from '../src/ai/schemas/finalSynthesisSchema.js';
import { RepairSectionSchema } from '../src/ai/schemas/repairSectionSchema.js';
import { DeepSeekSummaryProvider } from '../src/ai/providers/deepseekSummaryProvider.js';
import { generateValidatedProviderSummary } from '../summaryJobs.js';

afterEach(() => vi.unstubAllGlobals());

describe('Decoupled AI Providers & Zod Output Validation', () => {
  const router = new AIRouter({ useMocks: true });

  it('should validate HandwritingTranscriptionSchema with Zod', () => {
    const rawOutput = {
      transcription: 'Anotação do SUS',
      segments: [
        { text: 'Anotação do SUS', confidence: 0.9, alternatives: ['Alternativa 1'], bbox: null },
      ],
      annotationIntent: 'comment',
      language: 'por',
      unreadable: false,
      warnings: [],
    };
    const parsed = HandwritingTranscriptionSchema.parse(rawOutput);
    expect(parsed.transcription).toBe('Anotação do SUS');
    expect(parsed.annotationIntent).toBe('comment');
  });

  it('should validate VisualRelationsSchema with Zod', () => {
    const rawOutput = {
      relations: [
        {
          sourceRegionId: 'p1-region-01',
          targetBlockId: 'p1-heading-01',
          type: 'comments_on',
          confidence: 0.95,
          explanation: 'Comentário sobre o título do SUS',
        },
      ],
      orphanAnnotation: false,
      warnings: [],
    };
    const parsed = VisualRelationsSchema.parse(rawOutput);
    expect(parsed.relations).toHaveLength(1);
    expect(parsed.relations[0].type).toBe('comments_on');
  });

  it('should validate TableReconstructionSchema with Zod', () => {
    const rawOutput = {
      title: 'Modelos de Saúde',
      columns: ['Modelo', 'Características'],
      rows: [['Beveridgiano', 'Financiamento público via impostos']],
      confidence: 0.98,
      tableStructureUncertain: false,
      warnings: [],
    };
    const parsed = TableReconstructionSchema.parse(rawOutput);
    expect(parsed.columns).toEqual(['Modelo', 'Características']);
  });

  it('should execute MockVisionProvider and return validated responses', async () => {
    const res = await router.vision.classifyPage({
      jobId: 'job-1',
      documentId: 'doc-1',
      operationId: 'classify',
      input: { pageNumber: 1 },
    });
    expect(res.provider).toBe('mock-vision');
    expect(res.output.hasHandwriting).toBe(true);
  });

  it('should execute MockPlanningProvider and return validated summary plan', async () => {
    const res = await router.planning.createSummaryPlan({
      jobId: 'job-1',
      documentId: 'doc-1',
      operationId: 'plan',
      input: { documentIr: {}, preferences: {} },
    });
    const parsedPlan = SummaryPlanSchema.parse(res.output);
    expect(parsedPlan.sections).toHaveLength(1);
  });

  it('should execute MockSummaryProvider for section summary and final synthesis', async () => {
    const secRes = await router.summary.generateSection({
      jobId: 'job-1',
      documentId: 'doc-1',
      operationId: 'sec-summary',
      input: { sectionPlan: {}, sourceBlocks: [], preferences: {} },
    });
    const parsedSec = SectionSummarySchema.parse(secRes.output);
    expect(parsedSec.sectionKey).toBe('sec-1');

    const synRes = await router.summary.synthesizeFinalSummary({
      jobId: 'job-1',
      documentId: 'doc-1',
      operationId: 'final-synth',
      input: { title: 'SUS', sectionSummaries: [parsedSec], preferences: {} },
    });
    const parsedSyn = FinalSynthesisSchema.parse(synRes.output);
    expect(parsedSyn.title).toBe('Resumo do SUS');
  });

  it('should generate a validated page-grounded summary through the active provider contract', async () => {
    const result = await generateValidatedProviderSummary(router.summary, {
      jobId: 'job-1',
      documentId: 'doc-1',
      pages: [
        { page: 1, sourceName: 'aula.pdf', sourcePage: 1, text: 'Conteúdo A', blocks: [] },
        { page: 2, sourceName: 'aula.pdf', sourcePage: 2, text: 'Conteúdo B', blocks: [] },
      ],
      spec: 'Cubra todo o material.',
      preferences: {},
      answersText: '',
    });

    expect(result.summary).toContain('(p. 1)');
    expect(result.summary).toContain('(p. 2)');
    expect(result.response.output.claims).toHaveLength(2);
  });

  it('should fail closed when DeepSeek reports truncated output', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          finish_reason: 'length',
          message: { content: JSON.stringify({ sectionKey: 'summary', markdown: '# Parcial', claims: [] }) },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new DeepSeekSummaryProvider('test-key', 'https://example.invalid');
    await expect(provider.generateSection({
      jobId: 'job-1',
      documentId: 'doc-1',
      operationId: 'summary-validated',
      input: { sectionPlan: {}, sourceBlocks: [], preferences: {} },
      timeoutMs: 1000,
    })).rejects.toThrow(/limite de saída/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should execute MockSummaryProvider for section repair without creating a complemento section', async () => {
    const repairRes = await router.summary.repairSection({
      jobId: 'job-1',
      documentId: 'doc-1',
      operationId: 'repair-sec',
      input: {
        existingSection: { sectionKey: 'sec-1', markdown: '# Sec', claims: [], unusedBlockIds: [], warnings: [] },
        omittedBlocks: [],
        preferences: {},
      },
    });
    const parsedRepair = RepairSectionSchema.parse(repairRes.output);
    expect(parsedRepair.sectionKey).toBe('sec-1');
  });

  it('should select models according to document complexity in AIRouter', () => {
    const simple = router.selectModelsForDocument({ pageCount: 2, isComplex: false, hasHandwriting: false });
    expect(simple.isPlanningMandatory).toBe(false);
    expect(simple.summaryModel).toBe('deepseek-v4-flash');

    const complex = router.selectModelsForDocument({ pageCount: 15, isComplex: true, hasHandwriting: true });
    expect(complex.isPlanningMandatory).toBe(true);
    expect(complex.summaryModel).toBe('deepseek-v4-pro');
    expect(complex.visionModel).toBe('glm-4.5v');
  });
});
