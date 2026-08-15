import { AIProviderCallParams, AIProviderResponse, VisionProvider } from '../types.js';
import { executeAiCallWithValidation } from './baseProvider.js';
import { HandwritingTranscriptionOutput, HandwritingTranscriptionSchema } from '../schemas/handwritingSchema.js';
import { VisualRelationsOutput, VisualRelationsSchema } from '../schemas/visualRelationsSchema.js';
import { TableReconstructionOutput, TableReconstructionSchema } from '../schemas/tableReconstructionSchema.js';
import { HANDWRITING_TRANSCRIPTION_PROMPT_V1 } from '../prompts/handwriting-transcription/v1.js';
import { VISUAL_RELATIONS_PROMPT_V1 } from '../prompts/visual-relations/v1.js';
import { TABLE_RECONSTRUCTION_PROMPT_V1 } from '../prompts/table-reconstruction/v1.js';
import { PAGE_CLASSIFIER_PROMPT_V1 } from '../prompts/page-classifier/v1.js';
import { z } from 'zod';
import { providers } from '../../config/env.js';

export class GlmVisionProvider implements VisionProvider {
  name = 'glm';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || providers.zhipu.envKey;
    this.baseUrl = baseUrl || providers.zhipu.baseUrl;
  }

  private async fetchCompletions(messages: any[], model: string, maxTokens: number = 4096) {
    if (!this.apiKey) {
      throw new Error('ZHIPU_API_KEY / GLM Key não configurada no servidor.');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.05,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || `GLM respondeu ${response.status}`);
    }

    const content = payload?.choices?.[0]?.message?.content || '';
    const promptTokens = payload?.usage?.prompt_tokens ?? payload?.usage?.input_tokens ?? 0;
    const completionTokens = payload?.usage?.completion_tokens ?? payload?.usage?.output_tokens ?? 0;

    return { rawText: content, usage: { promptTokens, completionTokens } };
  }

  async classifyPage(
    params: AIProviderCallParams<{ imageBuffer?: Buffer; imagePath?: string; pageNumber: number }>
  ): Promise<AIProviderResponse<{ hasHandwriting: boolean; hasTables: boolean; isComplex: boolean }>> {
    const schema = z.object({
      hasHandwriting: z.boolean().default(false),
      hasTables: z.boolean().default(false),
      isComplex: z.boolean().default(false),
    });

    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: 'glm-4.5v',
      promptVersion: PAGE_CLASSIFIER_PROMPT_V1.version,
      schema,
      fetcher: async () => {
        const messages = [
          { role: 'system', content: PAGE_CLASSIFIER_PROMPT_V1.system },
          { role: 'user', content: PAGE_CLASSIFIER_PROMPT_V1.buildUserPrompt(params.input.pageNumber) },
        ];
        return this.fetchCompletions(messages, 'glm-4.5v', 1024);
      },
    });
  }

  async analyzeRegion(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; regionType: string; pageNumber: number }>
  ): Promise<AIProviderResponse<unknown>> {
    return this.classifyPage({
      ...params,
      input: { pageNumber: params.input.pageNumber },
    });
  }

  async analyzeVisualRelations(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; nearbyBlocks: unknown[]; sourceRegionId: string }>
  ): Promise<AIProviderResponse<VisualRelationsOutput>> {
    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: 'glm-4.5v',
      promptVersion: VISUAL_RELATIONS_PROMPT_V1.version,
      schema: VisualRelationsSchema,
      fetcher: async () => {
        const userPrompt = VISUAL_RELATIONS_PROMPT_V1.buildUserPrompt(
          params.input.sourceRegionId,
          params.input.nearbyBlocks
        );
        const userContent: any[] = [{ type: 'text', text: userPrompt }];
        if (params.input.cropBuffer) {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${params.input.cropBuffer.toString('base64')}` },
          });
        }
        const messages = [
          { role: 'system', content: VISUAL_RELATIONS_PROMPT_V1.system },
          { role: 'user', content: userContent },
        ];
        return this.fetchCompletions(messages, 'glm-4.5v', 2048);
      },
    });
  }

  async reconstructTable(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; tableBlock?: unknown }>
  ): Promise<AIProviderResponse<TableReconstructionOutput>> {
    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: 'glm-4.5v',
      promptVersion: TABLE_RECONSTRUCTION_PROMPT_V1.version,
      schema: TableReconstructionSchema,
      fetcher: async () => {
        const userPrompt = TABLE_RECONSTRUCTION_PROMPT_V1.buildUserPrompt(params.input.tableBlock);
        const userContent: any[] = [{ type: 'text', text: userPrompt }];
        if (params.input.cropBuffer) {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${params.input.cropBuffer.toString('base64')}` },
          });
        }
        const messages = [
          { role: 'system', content: TABLE_RECONSTRUCTION_PROMPT_V1.system },
          { role: 'user', content: userContent },
        ];
        return this.fetchCompletions(messages, 'glm-4.5v', 4096);
      },
    });
  }

  async describeDiagram(
    params: AIProviderCallParams<{ cropBuffer?: Buffer; cropPath?: string; diagramBlock?: unknown }>
  ): Promise<AIProviderResponse<{ description: string; entities: string[]; relations: string[] }>> {
    const schema = z.object({
      description: z.string().default('Diagrama médico'),
      entities: z.array(z.string()).default([]),
      relations: z.array(z.string()).default([]),
    });

    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: 'glm-4.5v',
      promptVersion: '1.0.0',
      schema,
      fetcher: async () => {
        const messages = [
          { role: 'system', content: 'Descreva o diagrama em JSON: {"description":"", "entities":[], "relations":[]}' },
          { role: 'user', content: 'Descreva o diagrama fornecido.' },
        ];
        return this.fetchCompletions(messages, 'glm-4.5v', 2048);
      },
    });
  }
}
