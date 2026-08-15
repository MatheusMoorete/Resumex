import { describe, expect, it, vi } from 'vitest';
import { getSupabaseAdminClient } from '../src/config/database.js';
import {
  createSummaryProcessingJob,
  persistSummaryResult,
  recordDocumentIrMetadata,
  storeSummaryDocument,
  updateSummaryProcessingJob,
} from '../src/services/summaryPersistence.js';

function createClient(options: { documentInsertError?: string } = {}) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const inserts: Record<string, any[]> = {};
  const updates: Record<string, any[]> = {};
  const upserts: Record<string, any[]> = {};

  const client = {
    storage: {
      from: vi.fn(() => ({ upload, remove })),
    },
    from: vi.fn((table: string) => ({
      upsert: async (payload: any) => {
        upserts[table] = [...(upserts[table] || []), payload];
        return { data: payload, error: null };
      },
      insert: (payload: any) => ({
        select: () => ({
          single: async () => {
            if (table === 'documents' && options.documentInsertError) {
              return { data: null, error: { message: options.documentInsertError } };
            }
            inserts[table] = [...(inserts[table] || []), payload];
            return { data: { id: payload.id || 'document-1', ...payload }, error: null };
          },
        }),
      }),
      update: (payload: any) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                updates[table] = [...(updates[table] || []), payload];
                return { data: { id: 'job-1', ...payload }, error: null };
              },
            }),
          }),
        }),
      }),
    })),
  };

  return { client: client as any, upload, remove, inserts, updates, upserts };
}

describe('Summary persistence bridge', () => {
  it('never treats a publishable key as an admin credential', () => {
    expect(getSupabaseAdminClient({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })).toBeNull();

    expect(getSupabaseAdminClient({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    })).not.toBeNull();
  });

  it('stores one PDF and persists the active job id and lifecycle', async () => {
    const mock = createClient();
    const stored = await storeSummaryDocument(mock.client, {
      jobId: 'job-1',
      userId: 'user-1',
      originalName: 'aula.pdf',
      buffer: Buffer.from('%PDF-1.7 test'),
    });

    await createSummaryProcessingJob(mock.client, {
      jobId: 'job-1',
      documentId: stored.documentId,
      userId: 'user-1',
      stage: 'Na fila',
      progress: 5,
    });
    await updateSummaryProcessingJob(mock.client, {
      jobId: 'job-1',
      userId: 'user-1',
      status: 'processing',
      stage: 'Extraindo',
      progress: 10,
      error: null,
    });
    await persistSummaryResult(mock.client, {
      jobId: 'job-1',
      documentId: stored.documentId,
      markdown: '# Resumo (p. 1)',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      modelVersion: '1.0.0',
      promptVersion: '1.0.0',
      claims: [{ sourceBlockIds: ['page-1'] }],
      warnings: [],
    });
    await recordDocumentIrMetadata(mock.client, {
      jobId: 'job-1',
      documentId: stored.documentId,
      userId: 'user-1',
      pageCount: 12,
      schemaVersion: '1.0.0',
      sourceHash: 'sha256-test',
    });
    await updateSummaryProcessingJob(mock.client, {
      jobId: 'job-1',
      documentId: stored.documentId,
      userId: 'user-1',
      status: 'completed',
      stage: 'Concluído',
      progress: 100,
      error: null,
    });

    expect(stored).toEqual({
      documentId: 'document-1',
      storagePath: 'user-1/job-1/original.pdf',
    });
    expect(mock.upload).toHaveBeenCalledOnce();
    expect(mock.inserts.processing_jobs[0]).toMatchObject({
      id: 'job-1',
      document_id: 'document-1',
      user_id: 'user-1',
      progress: 5,
    });
    expect(mock.updates.processing_jobs[0]).toMatchObject({
      state: 'processing',
      current_stage: 'Extraindo',
      progress: 10,
    });
    expect(mock.updates.documents[0]).toMatchObject({ status: 'processing', page_count: 12 });
    expect(mock.updates.processing_jobs[1].checkpoint.document_ir).toEqual({
      schema_version: '1.0.0',
      source_hash: 'sha256-test',
      page_count: 12,
    });
    expect(mock.updates.documents[1]).toMatchObject({ status: 'completed' });
    expect(mock.upserts.summary_versions[0]).toMatchObject({
      id: 'job-1',
      job_id: 'job-1',
      document_id: 'document-1',
      content: '# Resumo (p. 1)',
      status: 'published',
    });
  });

  it('removes the stored object when document metadata cannot be saved', async () => {
    const mock = createClient({ documentInsertError: 'insert failed' });

    await expect(storeSummaryDocument(mock.client, {
      jobId: 'job-1',
      userId: 'user-1',
      originalName: 'aula.pdf',
      buffer: Buffer.from('%PDF-1.7 test'),
    })).rejects.toThrow('insert failed');

    expect(mock.remove).toHaveBeenCalledWith(['user-1/job-1/original.pdf']);
  });
});
