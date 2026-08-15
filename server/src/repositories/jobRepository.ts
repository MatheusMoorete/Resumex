import { SupabaseClient } from '@supabase/supabase-js';
import { JobEventRecord, ProcessingJobRecord } from './types.js';

export class JobRepository {
  constructor(private client: SupabaseClient) {}

  async createJob(payload: {
    id?: string;
    document_id: string;
    user_id: string;
    type?: string;
    state?: string;
    progress?: number;
    current_stage?: string;
    max_attempts?: number;
  }): Promise<ProcessingJobRecord> {
    const jobPayload = {
      ...(payload.id ? { id: payload.id } : {}),
      document_id: payload.document_id,
      user_id: payload.user_id,
      type: payload.type || 'summary',
      state: payload.state || 'queued',
      progress: payload.progress ?? 0,
      current_stage: payload.current_stage || 'queued',
      attempt: 1,
      max_attempts: payload.max_attempts ?? 3,
      checkpoint: {},
    };

    const { data, error } = await this.client
      .from('processing_jobs')
      .insert(jobPayload)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao criar job de processamento: ${error?.message || 'Dados ausentes'}`);
    }

    return data as ProcessingJobRecord;
  }

  async getJobById(jobId: string, userId: string): Promise<ProcessingJobRecord | null> {
    const { data, error } = await this.client
      .from('processing_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Erro ao buscar job: ${error.message}`);
    }

    return data as ProcessingJobRecord | null;
  }

  async updateJobProgress(
    jobId: string,
    userId: string,
    updates: {
      state?: string;
      progress?: number;
      current_stage?: string;
      error_code?: string | null;
      error_message?: string | null;
      checkpoint?: Record<string, unknown>;
    }
  ): Promise<ProcessingJobRecord> {
    const payload: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    if (updates.state === 'processing' && !payload.started_at) {
      payload.started_at = new Date().toISOString();
    }
    if (['completed', 'failed', 'cancelled'].includes(updates.state || '')) {
      payload.finished_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('processing_jobs')
      .update(payload)
      .eq('id', jobId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao atualizar job: ${error?.message || 'Dados ausentes'}`);
    }

    return data as ProcessingJobRecord;
  }

  async addJobEvent(event: { job_id: string; sequence: number; event_type: string; stage: string; message: string; progress: number; metadata?: Record<string, unknown> }): Promise<JobEventRecord> {
    const payload = {
      job_id: event.job_id,
      sequence: event.sequence,
      event_type: event.event_type,
      stage: event.stage,
      message: event.message,
      progress: event.progress,
      metadata: event.metadata || {},
    };

    const { data, error } = await this.client
      .from('job_events')
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao adicionar evento do job: ${error?.message || 'Dados ausentes'}`);
    }

    return data as JobEventRecord;
  }

  async getJobEvents(jobId: string): Promise<JobEventRecord[]> {
    const { data, error } = await this.client
      .from('job_events')
      .select('*')
      .eq('job_id', jobId)
      .order('sequence', { ascending: true });

    if (error) {
      throw new Error(`Erro ao listar eventos do job: ${error.message}`);
    }

    return (data || []) as JobEventRecord[];
  }
}
