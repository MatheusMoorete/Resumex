import { AIProviderCallParams, AIProviderResponse, SummaryProvider } from '../types.js';
import { executeAiCallWithValidation } from './baseProvider.js';
import { SectionSummaryOutput, SectionSummarySchema } from '../schemas/sectionSummarySchema.js';
import { FinalSynthesisOutput, FinalSynthesisSchema } from '../schemas/finalSynthesisSchema.js';
import { RepairSectionOutput, RepairSectionSchema } from '../schemas/repairSectionSchema.js';
import { SECTION_SUMMARY_PROMPT_V1 } from '../prompts/section-summary/v1.js';
import { FINAL_SYNTHESIS_PROMPT_V1 } from '../prompts/final-synthesis/v1.js';
import { REPAIR_SECTION_PROMPT_V1 } from '../prompts/repair-section/v1.js';
import { providers } from '../../config/env.js';

export class DeepSeekSummaryProvider implements SummaryProvider {
  name = 'deepseek';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || providers.deepseek.envKey;
    this.baseUrl = baseUrl || providers.deepseek.baseUrl;
  }

  private async fetchCompletions(messages: any[], model: string, maxTokens: number = 16384, timeoutMs: number = 600000) {
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY não configurada no servidor.');
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
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || `DeepSeek respondeu ${response.status}`);
    }

    const rawText = payload?.choices?.[0]?.message?.content || '';
    if (!rawText.trim()) {
      throw new Error('DeepSeek retornou conteúdo vazio.');
    }
    if (payload?.choices?.[0]?.finish_reason === 'length') {
      throw new Error('DeepSeek atingiu o limite de saída.');
    }
    const promptTokens = payload?.usage?.prompt_tokens ?? 0;
    const completionTokens = payload?.usage?.completion_tokens ?? 0;

    return { rawText, usage: { promptTokens, completionTokens } };
  }

  async generateSection(
    params: AIProviderCallParams<{ sectionPlan: unknown; sourceBlocks: unknown[]; preferences: unknown }>
  ): Promise<AIProviderResponse<SectionSummaryOutput>> {
    const model = params.modelOptions?.model || 'deepseek-v4-pro';

    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: model,
      promptVersion: SECTION_SUMMARY_PROMPT_V1.version,
      schema: SectionSummarySchema,
      fetcher: async (_p, isRetry) => {
        const sysPrompt = isRetry
          ? `${SECTION_SUMMARY_PROMPT_V1.system}\nATENÇÃO: Sua resposta anterior falhou na validação. Retorne ESTRITAMENTE um JSON no formato exigido.`
          : SECTION_SUMMARY_PROMPT_V1.system;

        const messages = [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: SECTION_SUMMARY_PROMPT_V1.buildUserPrompt(params.input.sectionPlan, params.input.sourceBlocks, params.input.preferences) },
        ];
        return this.fetchCompletions(messages, model, params.modelOptions?.maxTokens || 12000, params.timeoutMs);
      },
    });
  }

  async synthesizeFinalSummary(
    params: AIProviderCallParams<{ title: string; sectionSummaries: SectionSummaryOutput[]; preferences: unknown }>
  ): Promise<AIProviderResponse<FinalSynthesisOutput>> {
    const model = params.modelOptions?.model || 'deepseek-v4-pro';

    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: model,
      promptVersion: FINAL_SYNTHESIS_PROMPT_V1.version,
      schema: FinalSynthesisSchema,
      fetcher: async (_p, isRetry) => {
        const sysPrompt = isRetry
          ? `${FINAL_SYNTHESIS_PROMPT_V1.system}\nATENÇÃO: A resposta deve ser um JSON estrito.`
          : FINAL_SYNTHESIS_PROMPT_V1.system;

        const messages = [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: FINAL_SYNTHESIS_PROMPT_V1.buildUserPrompt(params.input.title, params.input.sectionSummaries, params.input.preferences) },
        ];
        return this.fetchCompletions(messages, model, params.modelOptions?.maxTokens || 16384, params.timeoutMs);
      },
    });
  }

  async repairSection(
    params: AIProviderCallParams<{ existingSection: SectionSummaryOutput; omittedBlocks: unknown[]; preferences: unknown }>
  ): Promise<AIProviderResponse<RepairSectionOutput>> {
    const model = params.modelOptions?.model || 'deepseek-v4-pro';

    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: model,
      promptVersion: REPAIR_SECTION_PROMPT_V1.version,
      schema: RepairSectionSchema,
      fetcher: async (_p, isRetry) => {
        const sysPrompt = isRetry
          ? `${REPAIR_SECTION_PROMPT_V1.system}\nATENÇÃO: Retorne um JSON válido sem preâmbulos.`
          : REPAIR_SECTION_PROMPT_V1.system;

        const messages = [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: REPAIR_SECTION_PROMPT_V1.buildUserPrompt(params.input.existingSection, params.input.omittedBlocks, params.input.preferences) },
        ];
        return this.fetchCompletions(messages, model, params.modelOptions?.maxTokens || 12000, params.timeoutMs);
      },
    });
  }
}
