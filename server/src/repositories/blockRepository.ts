import { SupabaseClient } from '@supabase/supabase-js';
import { BlockRelationshipRecord, ContentBlockRecord } from './types.js';

export class BlockRepository {
  constructor(private client: SupabaseClient) {}

  async createContentBlocksBatch(blocks: Array<Omit<ContentBlockRecord, 'id' | 'created_at' | 'updated_at'>>): Promise<ContentBlockRecord[]> {
    if (!blocks.length) return [];

    const { data, error } = await this.client
      .from('content_blocks')
      .insert(blocks)
      .select();

    if (error || !data) {
      throw new Error(`Erro ao salvar blocos de conteúdo: ${error?.message || 'Dados ausentes'}`);
    }

    return data as ContentBlockRecord[];
  }

  async getContentBlocksByDocumentId(documentId: string): Promise<ContentBlockRecord[]> {
    const { data, error } = await this.client
      .from('content_blocks')
      .select('*')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true })
      .order('reading_order', { ascending: true });

    if (error) {
      throw new Error(`Erro ao buscar blocos do documento: ${error.message}`);
    }

    return (data || []) as ContentBlockRecord[];
  }

  async createBlockRelationshipsBatch(relationships: Array<Omit<BlockRelationshipRecord, 'id'>>): Promise<BlockRelationshipRecord[]> {
    if (!relationships.length) return [];

    const { data, error } = await this.client
      .from('block_relationships')
      .insert(relationships)
      .select();

    if (error || !data) {
      throw new Error(`Erro ao salvar relacionamentos de blocos: ${error?.message || 'Dados ausentes'}`);
    }

    return data as BlockRelationshipRecord[];
  }

  async getBlockRelationshipsByDocumentId(documentId: string): Promise<BlockRelationshipRecord[]> {
    const { data, error } = await this.client
      .from('block_relationships')
      .select('*')
      .eq('document_id', documentId);

    if (error) {
      throw new Error(`Erro ao buscar relacionamentos do documento: ${error.message}`);
    }

    return (data || []) as BlockRelationshipRecord[];
  }
}
