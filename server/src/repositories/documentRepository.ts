import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentPageRecord, DocumentRecord } from './types.js';

export class DocumentRepository {
  constructor(private client: SupabaseClient) {}

  async createDocument(doc: Partial<DocumentRecord> & { user_id: string; original_name: string; sha256: string; storage_path: string; size_bytes: number }): Promise<DocumentRecord> {
    const payload = {
      user_id: doc.user_id,
      organization_id: doc.organization_id ?? null,
      original_name: doc.original_name,
      mime_type: doc.mime_type || 'application/pdf',
      size_bytes: doc.size_bytes,
      sha256: doc.sha256,
      page_count: doc.page_count || 0,
      status: doc.status || 'uploaded',
      storage_path: doc.storage_path,
      retention_until: doc.retention_until ?? null,
    };

    const { data, error } = await this.client
      .from('documents')
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao criar documento: ${error?.message || 'Dados ausentes'}`);
    }

    return data as DocumentRecord;
  }

  async getDocumentById(id: string, userId: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.client
      .from('documents')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`Erro ao buscar documento: ${error.message}`);
    }

    return data as DocumentRecord | null;
  }

  async updateDocumentStatus(id: string, userId: string, status: string, pageCount?: number): Promise<DocumentRecord> {
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (typeof pageCount === 'number') {
      updatePayload.page_count = pageCount;
    }

    const { data, error } = await this.client
      .from('documents')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Erro ao atualizar status do documento: ${error?.message || 'Dados ausentes'}`);
    }

    return data as DocumentRecord;
  }

  async createDocumentPagesBatch(pages: Array<Omit<DocumentPageRecord, 'id' | 'created_at' | 'updated_at'>>): Promise<DocumentPageRecord[]> {
    if (!pages.length) return [];

    const { data, error } = await this.client
      .from('document_pages')
      .insert(pages)
      .select();

    if (error || !data) {
      throw new Error(`Erro ao salvar páginas do documento: ${error?.message || 'Dados ausentes'}`);
    }

    return data as DocumentPageRecord[];
  }

  async getDocumentPages(documentId: string): Promise<DocumentPageRecord[]> {
    const { data, error } = await this.client
      .from('document_pages')
      .select('*')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true });

    if (error) {
      throw new Error(`Erro ao buscar páginas do documento: ${error.message}`);
    }

    return (data || []) as DocumentPageRecord[];
  }
}
