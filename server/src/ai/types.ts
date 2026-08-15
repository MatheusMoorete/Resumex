import { HandwritingTranscriptionOutput } from './schemas/handwritingSchema.js';
import { VisualRelationsOutput } from './schemas/visualRelationsSchema.js';
import { TableReconstructionOutput } from './schemas/tableReconstructionSchema.js';
import { SummaryPlanOutput } from './schemas/summaryPlanSchema.js';
import { SectionSummaryOutput } from './schemas/sectionSummarySchema.js';
import { FinalSynthesisOutput } from './schemas/finalSynthesisSchema.js';
import { RepairSectionOutput } from './schemas/repairSectionSchema.js';

export interface AIProviderCallParams<TInput = unknown> {
  jobId: string;
  documentId: string;
  operationId: string;
  input: TInput;
  modelOptions?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  timeoutMs?: number;
  traceContext?: Record<string, unknown>;
}

export interface AIProviderResponse<TOutput = unknown> {
  provider: string;
  model: string;
  modelVersion: string;
  promptVersion: string;
  output: TOutput;
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
  };
  latencyMs: number;
  warnings: string[];
  rawResponseReference?: string;
}

export interface OcrProvider {
  name: string;
  extractPrintedText(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string }>
  ): Promise<AIProviderResponse<{ text: string; confidence: number }>>;
  extractHandwriting(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string; nearbyBlocks?: unknown[] }>
  ): Promise<AIProviderResponse<HandwritingTranscriptionOutput>>;
  extractLayout(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string }>
  ): Promise<AIProviderResponse<{ layoutType: string; blocks: unknown[] }>>;
}

export interface VisionProvider {
  name: string;
  classifyPage(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string; pageNumber: number }>
  ): Promise<AIProviderResponse<{ hasHandwriting: boolean; hasTables: boolean; isComplex: boolean }>>;
  analyzeRegion(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; regionType: string; pageNumber: number }>
  ): Promise<AIProviderResponse<unknown>>;
  analyzeVisualRelations(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; nearbyBlocks: unknown[]; sourceRegionId: string }>
  ): Promise<AIProviderResponse<VisualRelationsOutput>>;
  reconstructTable(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; tableBlock?: unknown }>
  ): Promise<AIProviderResponse<TableReconstructionOutput>>;
  describeDiagram(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; diagramBlock?: unknown }>
  ): Promise<AIProviderResponse<{ description: string; entities: string[]; relations: string[] }>>;
}

export interface PlanningProvider {
  name: string;
  createSummaryPlan(
    params: AIProviderCallParams<{ documentIr: unknown; preferences: unknown }>
  ): Promise<AIProviderResponse<SummaryPlanOutput>>;
}

export interface SummaryProvider {
  name: string;
  generateSection(
    params: AIProviderCallParams<{ sectionPlan: unknown; sourceBlocks: unknown[]; preferences: unknown }>
  ): Promise<AIProviderResponse<SectionSummaryOutput>>;
  synthesizeFinalSummary(
    params: AIProviderCallParams<{ title: string; sectionSummaries: SectionSummaryOutput[]; preferences: unknown }>
  ): Promise<AIProviderResponse<FinalSynthesisOutput>>;
  repairSection(
    params: AIProviderCallParams<{ existingSection: SectionSummaryOutput; omittedBlocks: unknown[]; preferences: unknown }>
  ): Promise<AIProviderResponse<RepairSectionOutput>>;
}
