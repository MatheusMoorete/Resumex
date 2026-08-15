import { AIProviderCallParams, AIProviderResponse, PlanningProvider } from '../types.js';
import { executeAiCallWithValidation } from './baseProvider.js';
import { SummaryPlanOutput, SummaryPlanSchema } from '../schemas/summaryPlanSchema.js';
import { SUMMARY_PLAN_PROMPT_V1 } from '../prompts/summary-plan/v1.js';
import { providers } from '../../config/env.js';

export class DeepSeekPlanningProvider implements PlanningProvider {
  name = 'deepseek';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || providers.deepseek.envKey;
    this.baseUrl = baseUrl || providers.deepseek.baseUrl;
  }

  async createSummaryPlan(
    params: AIProviderCallParams<{ documentIr: unknown; preferences: unknown }>
  ): Promise<AIProviderResponse<SummaryPlanOutput>> {
    const model = params.modelOptions?.model || 'deepseek-v4-flash';

    return executeAiCallWithValidation(params, {
      providerName: this.name,
      defaultModel: model,
      promptVersion: SUMMARY_PLAN_PROMPT_V1.version,
      schema: SummaryPlanSchema,
      fetcher: async (_p, isRetry) => {
        if (!this.apiKey) {
          throw new Error('DEEPSEEK_API_KEY não configurada no servidor.');
        }

        const systemContent = isRetry
          ? `${SUMMARY_PLAN_PROMPT_V1.system}\nATENÇÃO: Sua resposta anterior falhou na validação de formato. Retorne ESTRITAMENTE um JSON válido.`
          : SUMMARY_PLAN_PROMPT_V1.system;

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: SUMMARY_PLAN_PROMPT_V1.buildUserPrompt(params.input.documentIr, params.input.preferences) },
            ],
            max_tokens: params.modelOptions?.maxTokens || 8192,
            temperature: 0.1,
          }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error?.message || `DeepSeek respondeu ${response.status}`);
        }

        const rawText = payload?.choices?.[0]?.message?.content || '';
        const promptTokens = payload?.usage?.prompt_tokens ?? 0;
        const completionTokens = payload?.usage?.completion_tokens ?? 0;

        return { rawText, usage: { promptTokens, completionTokens } };
      },
    });
  }
}
