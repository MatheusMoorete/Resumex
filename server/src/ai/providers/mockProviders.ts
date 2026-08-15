import {
  AIProviderCallParams,
  AIProviderResponse,
  OcrProvider,
  PlanningProvider,
  SummaryProvider,
  VisionProvider,
} from '../types.js';
import { HandwritingTranscriptionOutput } from '../schemas/handwritingSchema.js';
import { VisualRelationsOutput } from '../schemas/visualRelationsSchema.js';
import { TableReconstructionOutput } from '../schemas/tableReconstructionSchema.js';
import { SummaryPlanOutput } from '../schemas/summaryPlanSchema.js';
import { SectionSummaryOutput } from '../schemas/sectionSummarySchema.js';
import { FinalSynthesisOutput } from '../schemas/finalSynthesisSchema.js';
import { RepairSectionOutput } from '../schemas/repairSectionSchema.js';

export class MockOcrProvider implements OcrProvider {
  name = 'mock-ocr';

  async extractPrintedText(
    params: AIProviderCallParams
  ): Promise<AIProviderResponse<{ text: string; confidence: number }>> {
    return {
      provider: this.name,
      model: 'mock-ocr-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: { text: 'Texto impresso mock', confidence: 1.0 },
      usage: { promptTokens: 10, completionTokens: 10 },
      latencyMs: 5,
      warnings: [],
    };
  }

  async extractHandwriting(
    params: AIProviderCallParams
  ): Promise<AIProviderResponse<HandwritingTranscriptionOutput>> {
    return {
      provider: this.name,
      model: 'mock-ocr-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: {
        transcription: 'Manuscrito mock',
        segments: [{ text: 'Manuscrito mock', confidence: 0.95, alternatives: [], bbox: null }],
        annotationIntent: 'comment',
        language: 'por',
        unreadable: false,
        warnings: [],
      },
      usage: { promptTokens: 10, completionTokens: 10 },
      latencyMs: 5,
      warnings: [],
    };
  }

  async extractLayout(
    params: AIProviderCallParams
  ): Promise<AIProviderResponse<{ layoutType: string; blocks: unknown[] }>> {
    return {
      provider: this.name,
      model: 'mock-ocr-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: { layoutType: 'single_column', blocks: [] },
      usage: { promptTokens: 10, completionTokens: 10 },
      latencyMs: 5,
      warnings: [],
    };
  }
}

export class MockVisionProvider implements VisionProvider {
  name = 'mock-vision';

  async classifyPage(): Promise<AIProviderResponse<{ hasHandwriting: boolean; hasTables: boolean; isComplex: boolean }>> {
    return {
      provider: this.name,
      model: 'mock-vision-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: { hasHandwriting: true, hasTables: true, isComplex: true },
      usage: { promptTokens: 15, completionTokens: 15 },
      latencyMs: 10,
      warnings: [],
    };
  }

  async analyzeRegion(): Promise<AIProviderResponse<unknown>> {
    return this.classifyPage();
  }

  async analyzeVisualRelations(): Promise<AIProviderResponse<VisualRelationsOutput>> {
    return {
      provider: this.name,
      model: 'mock-vision-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: {
        relations: [
          {
            sourceRegionId: 'p1-region-01',
            targetBlockId: 'p1-heading-01-a1b2c3',
            type: 'comments_on',
            confidence: 0.95,
            explanation: 'Comentário sobre o título do SUS',
          },
        ],
        orphanAnnotation: false,
        warnings: [],
      },
      usage: { promptTokens: 20, completionTokens: 20 },
      latencyMs: 10,
      warnings: [],
    };
  }

  async reconstructTable(): Promise<AIProviderResponse<TableReconstructionOutput>> {
    return {
      provider: this.name,
      model: 'mock-vision-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: {
        title: 'Tabela Mock',
        columns: ['Modelo', 'Financiamento'],
        rows: [['Smithiano', 'Privado']],
        confidence: 0.9,
        tableStructureUncertain: false,
        warnings: [],
      },
      usage: { promptTokens: 20, completionTokens: 20 },
      latencyMs: 10,
      warnings: [],
    };
  }

  async describeDiagram(): Promise<AIProviderResponse<{ description: string; entities: string[]; relations: string[] }>> {
    return {
      provider: this.name,
      model: 'mock-vision-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: { description: 'Fluxograma mock', entities: ['A', 'B'], relations: ['A -> B'] },
      usage: { promptTokens: 20, completionTokens: 20 },
      latencyMs: 10,
      warnings: [],
    };
  }
}

export class MockPlanningProvider implements PlanningProvider {
  name = 'mock-planning';

  async createSummaryPlan(): Promise<AIProviderResponse<SummaryPlanOutput>> {
    return {
      provider: this.name,
      model: 'mock-planning-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: {
        title: 'Plano de Resumo Mock',
        sections: [
          {
            key: 'sec-1',
            title: 'Introdução ao SUS',
            objective: 'Sintetizar aspectos históricos',
            sourceBlockIds: ['p1-heading-01-a1b2c3'],
            sourcePages: [1],
            priority: 1,
            estimatedTokens: 500,
          },
        ],
        uncoveredBlockIds: [],
        warnings: [],
      },
      usage: { promptTokens: 50, completionTokens: 50 },
      latencyMs: 15,
      warnings: [],
    };
  }
}

export class MockSummaryProvider implements SummaryProvider {
  name = 'mock-summary';

  async generateSection(
    params: AIProviderCallParams<{ sectionPlan: any; sourceBlocks: any[]; preferences: unknown }>
  ): Promise<AIProviderResponse<SectionSummaryOutput>> {
    const sectionKey = params.input.sectionPlan?.key || 'sec-1';
    const sourceBlockIds = params.input.sectionPlan?.sourceBlockIds?.length
      ? params.input.sectionPlan.sourceBlockIds
      : ['p1-heading-01-a1b2c3'];
    const sourcePages = params.input.sectionPlan?.sourcePages?.length
      ? params.input.sectionPlan.sourcePages
      : [1];
    return {
      provider: this.name,
      model: 'mock-summary-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: {
        sectionKey,
        markdown: `# Introdução ao SUS\n\n${sourcePages.map((page: number) => `Conteúdo da página ${page} (p. ${page}).`).join('\n')}`,
        claims: sourceBlockIds.map((id: string, index: number) => ({
          claimId: `claim-${index + 1}`,
          text: `Conteúdo rastreável ${index + 1}`,
          sourceBlockIds: [id],
          confidence: 1.0,
        })),
        unusedBlockIds: [],
        warnings: [],
      },
      usage: { promptTokens: 100, completionTokens: 100 },
      latencyMs: 20,
      warnings: [],
    };
  }

  async synthesizeFinalSummary(): Promise<AIProviderResponse<FinalSynthesisOutput>> {
    return {
      provider: this.name,
      model: 'mock-summary-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: {
        title: 'Resumo do SUS',
        markdown: '# Aspectos históricos do SUS (p. 1)\n\nO SUS foi conquistado pela sociedade civil.',
        sectionKeys: ['sec-1'],
        warnings: [],
      },
      usage: { promptTokens: 150, completionTokens: 150 },
      latencyMs: 25,
      warnings: [],
    };
  }

  async repairSection(): Promise<AIProviderResponse<RepairSectionOutput>> {
    return {
      provider: this.name,
      model: 'mock-summary-model',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      output: {
        sectionKey: 'sec-1',
        markdown: '# Introdução ao SUS (p. 1)\n\nO SUS foi conquistado pela sociedade civil.',
        claims: [],
        warnings: [],
      },
      usage: { promptTokens: 80, completionTokens: 80 },
      latencyMs: 15,
      warnings: [],
    };
  }
}
