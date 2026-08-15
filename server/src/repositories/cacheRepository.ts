import { SupabaseClient } from '@supabase/supabase-js';
import { ProcessingCacheRecord } from './types.js';

export class CacheRepository {
  constructor(private client: SupabaseClient) {}

  async getCache(cacheKey: string, ownerScope: 'user' | 'system' = 'user', ownerId?: string): Promise<ProcessingCacheRecord | null> {
    let query = this.client
      .from('processing_cache')
      .select('*')
      .eq('cache_key', cacheKey)
      .eq('owner_scope', ownerScope);

    if (ownerScope === 'user' && ownerId) {
      query = query.eq('owner_id', ownerId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Erro ao consultar cache de processamento: ${error.message}`);
    }

    if (data && data.expires_at) {
      if (new Date(data.expires_at).getTime() < Date.now()) {
        return null;
      }
    }

    if (data) {
      void this.client
        .from('processing_cache')
        .update({ last_accessed_at: new Date().toISOString() })
        .eq('id', data.id);
    }

    return data as ProcessingCacheRecord | null;
  }

  async setCache(entry: Omit<ProcessingCacheRecord, 'id' | 'created_at' | 'last_accessed_at'>): Promise<ProcessingCacheRecord> {
    const payload = {
      owner_scope: entry.owner_scope || 'user',
      owner_id: entry.owner_id || null,
      cache_type: entry.cache_type,
      cache_key: entry.cache_key,
      model: entry.model,
      model_version: entry.model_version || '1.0.0',
      prompt_version: entry.prompt_version || '1.0.0',
      extractor_version: entry.extractor_version || '1.0.0',
      payload: entry.payload,
      expires_at: entry.expires_at || null,
    };

    const { data, error } = await this.client
      .from('processing_cache')
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao salvar cache de processamento: ${error?.message || 'Dados ausentes'}`);
    }

    return data as ProcessingCacheRecord;
  }
}
