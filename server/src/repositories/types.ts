export interface DocumentRecord {
  id: string;
  user_id: string;
  organization_id?: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  page_count: number;
  status: string;
  storage_path: string;
  retention_until?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface DocumentPageRecord {
  id: string;
  document_id: string;
  page_number: number;
  width: number;
  height: number;
  rotation: number;
  native_text_coverage: number;
  raster_image_coverage: number;
  flags: string[];
  processing_plan: Record<string, unknown>;
  raster_hash?: string | null;
  status: string;
  warnings: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ContentBlockRecord {
  id: string;
  stable_key: string;
  document_id: string;
  page_id: string;
  page_number: number;
  block_type: string;
  semantic_role: string;
  text: string;
  bbox: Record<string, unknown>;
  polygon?: Record<string, unknown>[] | null;
  reading_order: number;
  source: string;
  confidence: number;
  language?: string | null;
  visual_attributes: Record<string, unknown>;
  checksum: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface BlockRelationshipRecord {
  id: string;
  document_id: string;
  source_block_id: string;
  target_block_id: string;
  relationship_type: string;
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface ProcessingJobRecord {
  id: string;
  document_id: string;
  user_id: string;
  type: string;
  state: string;
  progress: number;
  current_stage: string;
  attempt: number;
  max_attempts: number;
  checkpoint: Record<string, unknown>;
  error_code?: string | null;
  error_message?: string | null;
  cancellation_requested_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface JobEventRecord {
  id: string;
  job_id: string;
  sequence: number;
  event_type: string;
  stage: string;
  message: string;
  progress: number;
  metadata: Record<string, unknown>;
  created_at?: string;
}

export interface ModelCallRecord {
  id: string;
  job_id: string;
  document_id: string;
  provider: string;
  model: string;
  operation: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  image_count: number;
  latency_ms: number;
  estimated_cost_usd: number;
  actual_cost_usd?: number | null;
  status: string;
  retry_count: number;
  error_code?: string | null;
  created_at?: string;
}

export interface UsageLedgerRecord {
  id: string;
  user_id: string;
  organization_id?: string | null;
  document_id: string;
  job_id: string;
  operation: string;
  units: number;
  cost_usd: number;
  credits_delta: number;
  created_at?: string;
}

export interface ProcessingCacheRecord {
  id: string;
  owner_scope: 'user' | 'system';
  owner_id?: string | null;
  cache_type: string;
  cache_key: string;
  model: string;
  model_version: string;
  prompt_version: string;
  extractor_version: string;
  payload: Record<string, unknown>;
  expires_at?: string | null;
  created_at?: string;
  last_accessed_at?: string;
}

export interface UserCorrectionRecord {
  id: string;
  user_id: string;
  document_id: string;
  block_id: string;
  original_text: string;
  corrected_text: string;
  correction_type: string;
  created_at?: string;
}
