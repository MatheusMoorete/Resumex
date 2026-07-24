export interface ModelPricing {
  inputPer1M: number;
  cacheHitPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-flash': { inputPer1M: 0.14, cacheHitPer1M: 0.014, outputPer1M: 0.28 },
  'deepseek-v4-pro': { inputPer1M: 0.27, cacheHitPer1M: 0.027, outputPer1M: 1.10 },
  'glm-4.5v': { inputPer1M: 0.60, cacheHitPer1M: 0.10, outputPer1M: 1.20 },
  'kimi-k3': { inputPer1M: 0.50, cacheHitPer1M: 0.10, outputPer1M: 1.50 },
  'moonshotai/kimi-k3': { inputPer1M: 0.50, cacheHitPer1M: 0.10, outputPer1M: 1.50 },
  'gpt-5.6-terra': { inputPer1M: 1.50, cacheHitPer1M: 0.30, outputPer1M: 6.00 },
  'openai/gpt-5.6-terra-pro': { inputPer1M: 2.50, cacheHitPer1M: 0.50, outputPer1M: 10.00 },
};

const DEFAULT_PRICING: ModelPricing = { inputPer1M: 0.30, cacheHitPer1M: 0.05, outputPer1M: 1.00 };

export function calculateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number = 0
): number {
  const modelKey = Object.keys(MODEL_PRICING).find((key) => model.includes(key)) || '';
  const pricing = MODEL_PRICING[modelKey] || DEFAULT_PRICING;

  const actualInputTokens = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (actualInputTokens / 1_000_000) * pricing.inputPer1M;
  const cacheCost = (cachedTokens / 1_000_000) * pricing.cacheHitPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;

  return Number((inputCost + cacheCost + outputCost).toFixed(6));
}

export function inferFlowType(role: string): 'summary' | 'quiz' | 'flashcards' | 'system' {
  if (role.startsWith('quiz')) return 'quiz';
  if (role.startsWith('summary') || role === 'spec' || role === 'evidence' || role === 'spec-correction') return 'summary';
  if (role.startsWith('flashcard')) return 'flashcards';
  return 'system';
}

export interface RecordUsageParams {
  role: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  durationMs: number;
  finishReason?: string;
  error?: boolean;
}

export interface UsageRecord extends RecordUsageParams {
  timestamp: string;
  flowType: 'summary' | 'quiz' | 'flashcards' | 'system';
  costUsd: number;
}

class TelemetryService {
  private records: UsageRecord[] = [];
  private readonly maxRecords = 2000;

  public recordUsage(params: RecordUsageParams): UsageRecord {
    const flowType = inferFlowType(params.role);
    const cachedTokens = params.cachedTokens || 0;
    const costUsd = calculateCostUsd(
      params.model,
      params.promptTokens,
      params.completionTokens,
      cachedTokens
    );

    const record: UsageRecord = {
      ...params,
      cachedTokens,
      timestamp: new Date().toISOString(),
      flowType,
      costUsd,
    };

    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    if (params.durationMs > 15000) {
      console.warn(
        JSON.stringify({
          event: 'telemetry_bottleneck_warning',
          role: params.role,
          flowType,
          durationMs: params.durationMs,
          costUsd,
          model: params.model,
        })
      );
    }

    return record;
  }

  public getSummaryMetrics() {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const totalRequests = this.records.length;
    const requests24h = this.records.filter((r) => new Date(r.timestamp).getTime() >= oneDayAgo);

    const totalCostUsd = Number(this.records.reduce((acc, r) => acc + r.costUsd, 0).toFixed(4));
    const cost24hUsd = Number(requests24h.reduce((acc, r) => acc + r.costUsd, 0).toFixed(4));

    const totalPromptTokens = this.records.reduce((acc, r) => acc + r.promptTokens, 0);
    const totalCompletionTokens = this.records.reduce((acc, r) => acc + r.completionTokens, 0);
    const totalCachedTokens = this.records.reduce((acc, r) => acc + (r.cachedTokens || 0), 0);

    const cacheHitRatePercent = totalPromptTokens > 0
      ? Number(((totalCachedTokens / totalPromptTokens) * 100).toFixed(2))
      : 0;

    const flowBreakdown: Record<string, { requests: number; costUsd: number; avgDurationMs: number }> = {};
    const roleBreakdown: Record<string, { requests: number; costUsd: number; avgDurationMs: number }> = {};

    ['summary', 'quiz', 'flashcards', 'system'].forEach((flow) => {
      const flowRecords = this.records.filter((r) => r.flowType === flow);
      const reqs = flowRecords.length;
      const cost = Number(flowRecords.reduce((acc, r) => acc + r.costUsd, 0).toFixed(4));
      const avgDur = reqs > 0 ? Math.round(flowRecords.reduce((acc, r) => acc + r.durationMs, 0) / reqs) : 0;
      flowBreakdown[flow] = { requests: reqs, costUsd: cost, avgDurationMs: avgDur };
    });

    const uniqueRoles = [...new Set(this.records.map((r) => r.role))];
    uniqueRoles.forEach((role) => {
      const roleRecords = this.records.filter((r) => r.role === role);
      const reqs = roleRecords.length;
      const cost = Number(roleRecords.reduce((acc, r) => acc + r.costUsd, 0).toFixed(4));
      const avgDur = reqs > 0 ? Math.round(roleRecords.reduce((acc, r) => acc + r.durationMs, 0) / reqs) : 0;
      roleBreakdown[role] = { requests: reqs, costUsd: cost, avgDurationMs: avgDur };
    });

    const slowRequests = [...this.records]
      .filter((r) => r.durationMs >= 8000)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 10)
      .map((r) => ({
        role: r.role,
        flowType: r.flowType,
        model: r.model,
        durationMs: r.durationMs,
        costUsd: r.costUsd,
        timestamp: r.timestamp,
      }));

    return {
      overview: {
        totalRequests,
        requests24h: requests24h.length,
        totalCostUsd,
        cost24hUsd,
        totalPromptTokens,
        totalCompletionTokens,
        totalCachedTokens,
        cacheHitRatePercent,
      },
      flowBreakdown,
      roleBreakdown,
      slowRequestsBottlenecks: slowRequests,
    };
  }

  public resetMetrics(): void {
    this.records = [];
  }
}

export const telemetry = new TelemetryService();
