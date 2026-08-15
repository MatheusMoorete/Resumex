import { createHash } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentRepository } from '../repositories/documentRepository.js';
import { JobRepository } from '../repositories/jobRepository.js';

export interface PersistedSummaryState {
  status: 'queued' | 'processing' | 'awaiting_review' | 'completed' | 'failed';
  stage: string;
  progress: number;
  error: string | null;
}

export async function storeSummaryDocument(
  client: SupabaseClient,
  input: { jobId: string; userId: string; originalName: string; buffer: Buffer }
): Promise<{ documentId: string; storagePath: string }> {
  const storagePath = `${input.userId}/${input.jobId}/original.pdf`;
  const bucket = client.storage.from('document-originals');
  const { error: uploadError } = await bucket.upload(storagePath, input.buffer, {
    contentType: 'application/pdf',
    upsert: false,
  });

  if (uploadError) {
    throw new Error(`Erro ao armazenar PDF: ${uploadError.message}`);
  }

  try {
    const document = await new DocumentRepository(client).createDocument({
      user_id: input.userId,
      original_name: input.originalName,
      sha256: createHash('sha256').update(input.buffer).digest('hex'),
      storage_path: storagePath,
      size_bytes: input.buffer.length,
    });
    return { documentId: document.id, storagePath };
  } catch (error) {
    await bucket.remove([storagePath]);
    throw error;
  }
}

export async function createSummaryProcessingJob(
  client: SupabaseClient,
  input: { jobId: string; documentId: string; userId: string; stage: string; progress: number }
): Promise<void> {
  await new JobRepository(client).createJob({
    id: input.jobId,
    document_id: input.documentId,
    user_id: input.userId,
    state: 'queued',
    progress: input.progress,
    current_stage: input.stage,
  });
}

export async function updateSummaryProcessingJob(
  client: SupabaseClient,
  input: { jobId: string; documentId?: string; userId: string } & PersistedSummaryState
): Promise<void> {
  await new JobRepository(client).updateJobProgress(input.jobId, input.userId, {
    state: input.status,
    progress: input.progress,
    current_stage: input.stage,
    error_code: input.status === 'failed' ? 'summary_pipeline_failed' : null,
    error_message: input.error,
  });

  if (input.documentId && ['completed', 'failed'].includes(input.status)) {
    await new DocumentRepository(client).updateDocumentStatus(
      input.documentId,
      input.userId,
      input.status
    );
  }
}

export async function recordDocumentIrMetadata(
  client: SupabaseClient,
  input: {
    jobId: string;
    documentId: string;
    userId: string;
    pageCount: number;
    schemaVersion: string;
    sourceHash: string;
  }
): Promise<void> {
  await new DocumentRepository(client).updateDocumentStatus(
    input.documentId,
    input.userId,
    'processing',
    input.pageCount
  );
  await new JobRepository(client).updateJobProgress(input.jobId, input.userId, {
    checkpoint: {
      document_ir: {
        schema_version: input.schemaVersion,
        source_hash: input.sourceHash,
        page_count: input.pageCount,
      },
    },
  });
}

export async function persistSummaryResult(
  client: SupabaseClient,
  input: {
    jobId: string;
    documentId: string;
    markdown: string;
    provider: string;
    model: string;
    modelVersion: string;
    promptVersion: string;
    claims: unknown[];
    warnings: string[];
  }
): Promise<void> {
  const { error } = await client
    .from('summary_versions')
    .upsert({
      id: input.jobId,
      document_id: input.documentId,
      job_id: input.jobId,
      version: 1,
      format: 'markdown',
      content: input.markdown,
      structure: {
        provider: input.provider,
        model: input.model,
        model_version: input.modelVersion,
        prompt_version: input.promptVersion,
        claims: input.claims,
        warnings: input.warnings,
      },
      status: 'published',
    }, { onConflict: 'id' });

  if (error) {
    throw new Error(`Erro ao persistir resumo: ${error.message}`);
  }
}
