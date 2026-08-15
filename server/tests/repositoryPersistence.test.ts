import { describe, expect, it, vi } from 'vitest';
import { DocumentRepository } from '../src/repositories/documentRepository.js';
import { JobRepository } from '../src/repositories/jobRepository.js';
import { BlockRepository } from '../src/repositories/blockRepository.js';
import { CacheRepository } from '../src/repositories/cacheRepository.js';
import { LedgerRepository } from '../src/repositories/ledgerRepository.js';

function createMockSupabaseClient(tableStore: Record<string, any[]> = {}) {
  return {
    from: (tableName: string) => {
      const store = tableStore[tableName] || [];
      tableStore[tableName] = store;

      let currentFilters: Array<(item: any) => boolean> = [];
      let isSingle = false;
      let isMaybeSingle = false;
      let orderField: string | null = null;
      let orderAscending = true;

      const builder = {
        select: (_cols?: string) => builder,
        insert: (payload: any) => {
          const items = Array.isArray(payload) ? payload : [payload];
          const created = items.map((item, idx) => ({
            id: item.id || `uuid-${tableName}-${Date.now()}-${idx}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...item,
          }));
          store.push(...created);
          return {
            select: () => ({
              single: () => ({ data: created[0], error: null }),
              maybeSingle: () => ({ data: created[0], error: null }),
              data: created,
              error: null,
            }),
            data: created,
            error: null,
          };
        },
        update: (payload: any) => {
          return {
            eq: (field: string, val: any) => {
              currentFilters.push((item) => item[field] === val);
              return {
                eq: (field2: string, val2: any) => {
                  currentFilters.push((item) => item[field2] === val2);
                  return {
                    select: () => {
                      const updated: any[] = [];
                      for (const item of store) {
                        if (currentFilters.every((fn) => fn(item))) {
                          Object.assign(item, payload);
                          updated.push(item);
                        }
                      }
                      return {
                        single: () => ({ data: updated[0], error: null }),
                        maybeSingle: () => ({ data: updated[0] || null, error: null }),
                        data: updated,
                        error: null,
                      };
                    },
                  };
                },
                select: () => {
                  const updated: any[] = [];
                  for (const item of store) {
                    if (currentFilters.every((fn) => fn(item))) {
                      Object.assign(item, payload);
                      updated.push(item);
                    }
                  }
                  return {
                    single: () => ({ data: updated[0], error: null }),
                    maybeSingle: () => ({ data: updated[0] || null, error: null }),
                    data: updated,
                    error: null,
                  };
                },
              };
            },
          };
        },
        eq: (field: string, val: any) => {
          currentFilters.push((item) => item[field] === val);
          return builder;
        },
        is: (field: string, val: any) => {
          currentFilters.push((item) => (val === null ? item[field] == null : item[field] === val));
          return builder;
        },
        order: (field: string, opts: { ascending?: boolean } = {}) => {
          orderField = field;
          orderAscending = opts.ascending !== false;
          return builder;
        },
        single: () => {
          isSingle = true;
          return builder.then();
        },
        maybeSingle: () => {
          isMaybeSingle = true;
          return builder.then();
        },
        then: (resolve?: any) => {
          let results = store.filter((item) => currentFilters.every((fn) => fn(item)));
          if (orderField) {
            results.sort((a, b) => {
              const valA = a[orderField!];
              const valB = b[orderField!];
              if (valA < valB) return orderAscending ? -1 : 1;
              if (valA > valB) return orderAscending ? 1 : -1;
              return 0;
            });
          }
          const resData = isSingle ? results[0] : isMaybeSingle ? results[0] || null : results;
          const result = { data: resData, error: null };
          return resolve ? resolve(result) : Promise.resolve(result);
        },
      };
      return builder as any;
    },
  };
}

describe('Pipeline Repositories Persistence & Multi-Tenant Security', () => {
  it('should create document and isolate user records logically', async () => {
    const store: Record<string, any[]> = {};
    const mockClient = createMockSupabaseClient(store);
    const docRepo = new DocumentRepository(mockClient as any);

    const user1Doc = await docRepo.createDocument({
      user_id: 'user-1',
      original_name: 'modulo1.pdf',
      sha256: 'hash1',
      storage_path: 'user-1/modulo1.pdf',
      size_bytes: 1024,
    });

    expect(user1Doc.id).toBeDefined();
    expect(user1Doc.user_id).toBe('user-1');

    const foundUser1 = await docRepo.getDocumentById(user1Doc.id, 'user-1');
    expect(foundUser1).not.toBeNull();
    expect(foundUser1?.original_name).toBe('modulo1.pdf');

    const foundUser2 = await docRepo.getDocumentById(user1Doc.id, 'user-2');
    expect(foundUser2).toBeNull();
  });

  it('should create processing job, update progress and checkpoints', async () => {
    const store: Record<string, any[]> = {};
    const mockClient = createMockSupabaseClient(store);
    const jobRepo = new JobRepository(mockClient as any);

    const job = await jobRepo.createJob({
      id: 'job-100',
      document_id: 'doc-100',
      user_id: 'user-1',
      type: 'summary',
    });

    expect(job.id).toBe('job-100');
    expect(job.state).toBe('queued');
    expect(job.progress).toBe(0);

    const updatedJob = await jobRepo.updateJobProgress(job.id, 'user-1', {
      state: 'processing',
      progress: 50,
      current_stage: 'Visual OCR',
      checkpoint: { completedPages: [1, 2], lastBlockId: 'p2-paragraph-01-a1b2c3' },
    });

    expect(updatedJob.state).toBe('processing');
    expect(updatedJob.progress).toBe(50);
    expect(updatedJob.checkpoint).toEqual({ completedPages: [1, 2], lastBlockId: 'p2-paragraph-01-a1b2c3' });
  });

  it('should persist content blocks and block relationships', async () => {
    const store: Record<string, any[]> = {};
    const mockClient = createMockSupabaseClient(store);
    const blockRepo = new BlockRepository(mockClient as any);

    const blocks = await blockRepo.createContentBlocksBatch([
      {
        stable_key: 'p1-heading-01-a1b2c3',
        document_id: 'doc-100',
        page_id: 'page-1',
        page_number: 1,
        block_type: 'heading',
        semantic_role: 'title',
        text: 'Aspectos do SUS',
        bbox: { x0: 0, y0: 0, x1: 100, y1: 50 },
        reading_order: 1,
        source: 'pdf_native',
        confidence: 1.0,
        visual_attributes: {},
        checksum: 'chk-1',
        metadata: {},
      },
      {
        stable_key: 'p1-handwriting-02-d4e5f6',
        document_id: 'doc-100',
        page_id: 'page-1',
        page_number: 1,
        block_type: 'handwriting',
        semantic_role: 'body',
        text: 'Nota manuscrita',
        bbox: { x0: 0, y0: 60, x1: 100, y1: 90 },
        reading_order: 2,
        source: 'vision_model',
        confidence: 0.9,
        visual_attributes: {},
        checksum: 'chk-2',
        metadata: {},
      },
    ]);

    expect(blocks).toHaveLength(2);

    const relationships = await blockRepo.createBlockRelationshipsBatch([
      {
        document_id: 'doc-100',
        source_block_id: blocks[1].id,
        target_block_id: blocks[0].id,
        relationship_type: 'comments_on',
        confidence: 0.95,
        metadata: {},
      },
    ]);

    expect(relationships).toHaveLength(1);
    expect(relationships[0].source_block_id).toBe(blocks[1].id);
    expect(relationships[0].target_block_id).toBe(blocks[0].id);

    const docBlocks = await blockRepo.getContentBlocksByDocumentId('doc-100');
    expect(docBlocks).toHaveLength(2);
  });

  it('should isolate user cache from system cache', async () => {
    const store: Record<string, any[]> = {};
    const mockClient = createMockSupabaseClient(store);
    const cacheRepo = new CacheRepository(mockClient as any);

    await cacheRepo.setCache({
      owner_scope: 'user',
      owner_id: 'user-1',
      cache_type: 'summary_spec',
      cache_key: 'key-hash-1',
      model: 'deepseek-v4-flash',
      model_version: '1.0.0',
      prompt_version: '1.0.0',
      extractor_version: '1.0.0',
      payload: { spec: 'Plano estruturado' },
    });

    const user1Cache = await cacheRepo.getCache('key-hash-1', 'user', 'user-1');
    expect(user1Cache).not.toBeNull();
    expect(user1Cache?.payload).toEqual({ spec: 'Plano estruturado' });

    const user2Cache = await cacheRepo.getCache('key-hash-1', 'user', 'user-2');
    expect(user2Cache).toBeNull();
  });

  it('should record model calls and usage ledger entries', async () => {
    const store: Record<string, any[]> = {};
    const mockClient = createMockSupabaseClient(store);
    const ledgerRepo = new LedgerRepository(mockClient as any);

    const call = await ledgerRepo.recordModelCall({
      job_id: 'job-1',
      document_id: 'doc-100',
      provider: 'zhipu',
      model: 'glm-4.5v',
      operation: 'vision_ocr',
      prompt_version: '1.0.0',
      input_tokens: 1000,
      output_tokens: 200,
      image_count: 1,
      latency_ms: 1500,
      estimated_cost_usd: 0.001,
      status: 'success',
      retry_count: 0,
    });

    expect(call.id).toBeDefined();
    expect(call.estimated_cost_usd).toBe(0.001);

    const ledger = await ledgerRepo.recordUsageLedger({
      user_id: 'user-1',
      document_id: 'doc-100',
      job_id: 'job-1',
      operation: 'summary_job',
      units: 1,
      cost_usd: 0.001,
      credits_delta: -0.001,
    });

    expect(ledger.user_id).toBe('user-1');

    const userLedger = await ledgerRepo.getUserUsageLedger('user-1');
    expect(userLedger).toHaveLength(1);
  });
});
