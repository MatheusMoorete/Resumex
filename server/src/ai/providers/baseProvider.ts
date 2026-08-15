import { z } from 'zod';
import { AIProviderCallParams, AIProviderResponse } from '../types.js';
import { calculateCostUsd, telemetry } from '../../services/telemetry.js';

export interface BaseExecuteOptions<TOutput> {
  providerName: string;
  defaultModel: string;
  modelVersion?: string;
  promptVersion: string;
  schema: z.ZodSchema<TOutput>;
  fetcher: (params: AIProviderCallParams, isRetry: boolean) => Promise<{ rawText: string; usage: { promptTokens: number; completionTokens: number; cachedTokens?: number } }>;
}

export async function executeAiCallWithValidation<TInput, TOutput>(
  params: AIProviderCallParams<TInput>,
  options: BaseExecuteOptions<TOutput>
): Promise<AIProviderResponse<TOutput>> {
  const model = params.modelOptions?.model || options.defaultModel;
  const startTime = Date.now();
  const warnings: string[] = [];

  let isRetry = false;
  let rawText = '';
  let usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
  let parsedJson: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const fetchResult = await options.fetcher(params, isRetry);
      rawText = fetchResult.rawText;
      usage = {
        promptTokens: fetchResult.usage.promptTokens || 0,
        completionTokens: fetchResult.usage.completionTokens || 0,
        cachedTokens: fetchResult.usage.cachedTokens || 0,
      };

      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/) || rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Formato da resposta não é um JSON válido.');
        }
      }

      const validatedOutput = options.schema.parse(parsedJson);
      const latencyMs = Date.now() - startTime;
      const costUsd = calculateCostUsd(model, usage.promptTokens, usage.completionTokens, usage.cachedTokens);

      telemetry.recordUsage({
        role: params.operationId,
        provider: options.providerName,
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedTokens: usage.cachedTokens,
        durationMs: latencyMs,
      });

      return {
        provider: options.providerName,
        model,
        modelVersion: options.modelVersion || '1.0.0',
        promptVersion: options.promptVersion,
        output: validatedOutput,
        usage,
        latencyMs,
        warnings,
      };
    } catch (err: any) {
      if (attempt === 1) {
        isRetry = true;
        warnings.push(`Formato inválido na primeira tentativa. Erro: ${err?.message || 'Schema mismatch'}. Tentando correção de formato...`);
      } else {
        const latencyMs = Date.now() - startTime;
        telemetry.recordUsage({
          role: params.operationId,
          provider: options.providerName,
          model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          cachedTokens: usage.cachedTokens,
          durationMs: latencyMs,
          error: true,
        });

        throw new Error(
          `Falha na validação de schema do provedor ${options.providerName} (${model}): ${err?.message || 'Zod validation failed'}`
        );
      }
    }
  }

  throw new Error('Falha inesperada no pipeline de execução de IA.');
}
