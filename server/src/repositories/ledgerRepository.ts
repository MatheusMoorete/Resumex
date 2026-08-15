import { SupabaseClient } from '@supabase/supabase-js';
import { ModelCallRecord, UsageLedgerRecord } from './types.js';

export class LedgerRepository {
  constructor(private client: SupabaseClient) {}

  async recordModelCall(call: Omit<ModelCallRecord, 'id' | 'created_at'>): Promise<ModelCallRecord> {
    const payload = {
      job_id: call.job_id,
      document_id: call.document_id,
      provider: call.provider,
      model: call.model,
      operation: call.operation,
      prompt_version: call.prompt_version || '1.0.0',
      input_tokens: call.input_tokens || 0,
      output_tokens: call.output_tokens || 0,
      image_count: call.image_count || 0,
      latency_ms: call.latency_ms || 0,
      estimated_cost_usd: call.estimated_cost_usd || 0.0,
      actual_cost_usd: call.actual_cost_usd ?? null,
      status: call.status || 'success',
      retry_count: call.retry_count || 0,
      error_code: call.error_code || null,
    };

    const { data, error } = await this.client
      .from('model_calls')
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao registrar chamada de modelo: ${error?.message || 'Dados ausentes'}`);
    }

    return data as ModelCallRecord;
  }

  async recordUsageLedger(entry: Omit<UsageLedgerRecord, 'id' | 'created_at'>): Promise<UsageLedgerRecord> {
    const payload = {
      user_id: entry.user_id,
      organization_id: entry.organization_id || null,
      document_id: entry.document_id,
      job_id: entry.job_id,
      operation: entry.operation,
      units: entry.units || 1,
      cost_usd: entry.cost_usd || 0.0,
      credits_delta: entry.credits_delta || 0.0,
    };

    const { data, error } = await this.client
      .from('usage_ledger')
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao registrar uso no ledger: ${error?.message || 'Dados ausentes'}`);
    }

    return data as UsageLedgerRecord;
  }

  async getUserUsageLedger(userId: string): Promise<UsageLedgerRecord[]> {
    const { data, error } = await this.client
      .from('usage_ledger')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Erro ao buscar histórico de consumo do usuário: ${error.message}`);
    }

    return (data || []) as UsageLedgerRecord[];
  }
}
