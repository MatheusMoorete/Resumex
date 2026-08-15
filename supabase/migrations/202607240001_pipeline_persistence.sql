-- Migration: Pipeline Persistence Schema (ResumeX V2 Commercial)

-- 1. DOCUMENTS
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid null,
  original_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null,
  page_count integer not null default 0 check (page_count >= 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'completed', 'failed')),
  storage_path text not null,
  retention_until timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  unique (id, user_id)
);

-- 2. DOCUMENT_PAGES
create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  width double precision not null check (width > 0),
  height double precision not null check (height > 0),
  rotation integer not null default 0 check (rotation in (0, 90, 180, 270)),
  native_text_coverage double precision not null default 0.0 check (native_text_coverage between 0.0 and 1.0),
  raster_image_coverage double precision not null default 0.0 check (raster_image_coverage between 0.0 and 1.0),
  flags jsonb not null default '[]'::jsonb,
  processing_plan jsonb not null default '{}'::jsonb,
  raster_hash text null,
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'error')),
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, page_number),
  unique (id, document_id, page_number)
);

-- 3. CONTENT_BLOCKS
create table if not exists public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_id uuid not null,
  page_number integer not null check (page_number >= 1),
  block_type text not null check (block_type in (
    'native_text', 'printed_ocr', 'handwriting', 'heading', 'paragraph',
    'list_item', 'table', 'table_row', 'table_cell', 'image', 'image_caption',
    'diagram', 'chart', 'highlight', 'underline', 'strikeout', 'arrow',
    'callout', 'annotation', 'decorative'
  )),
  semantic_role text not null default 'unknown' check (semantic_role in (
    'title', 'subtitle', 'body', 'definition', 'example', 'warning',
    'exam_tip', 'caption', 'footnote', 'table_header', 'table_value', 'unknown'
  )),
  text text not null default '',
  bbox jsonb not null,
  polygon jsonb null,
  reading_order integer not null default 0 check (reading_order >= 0),
  source text not null check (source in (
    'pdf_native', 'pdf_annotation', 'pdf_vector', 'pdf_embedded_image',
    'local_ocr', 'cloud_ocr', 'vision_model', 'user_correction'
  )),
  confidence double precision not null default 1.0 check (confidence between 0.0 and 1.0),
  language text null,
  visual_attributes jsonb not null default '{}'::jsonb,
  checksum text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (page_id, document_id, page_number)
    references public.document_pages(id, document_id, page_number) on delete cascade,
  unique (id, document_id),
  unique (id, document_id, page_number)
);

-- 4. BLOCK_RELATIONSHIPS
create table if not exists public.block_relationships (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  source_block_id uuid not null,
  target_block_id uuid not null,
  relationship_type text not null check (relationship_type in (
    'comments_on', 'points_to', 'highlights', 'corrects', 'contradicts',
    'labels', 'caption_of', 'continuation_of', 'belongs_to_table',
    'belongs_to_section'
  )),
  confidence double precision not null default 1.0 check (confidence between 0.0 and 1.0),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (source_block_id, document_id)
    references public.content_blocks(id, document_id) on delete cascade,
  foreign key (target_block_id, document_id)
    references public.content_blocks(id, document_id) on delete cascade
);

-- 5. PROCESSING_JOBS
create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'summary' check (type = 'summary'),
  state text not null default 'queued' check (state in (
    'queued', 'processing', 'awaiting_review', 'completed', 'failed', 'cancelled'
  )),
  progress integer not null default 0 check (progress between 0 and 100),
  current_stage text not null default 'queued',
  attempt integer not null default 1 check (attempt >= 1),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  checkpoint jsonb not null default '{}'::jsonb,
  error_code text null,
  error_message text null,
  cancellation_requested_at timestamptz null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade,
  unique (id, document_id)
);

-- 6. JOB_EVENTS
create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  event_type text not null,
  stage text not null,
  message text not null,
  progress integer not null check (progress between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 7. MODEL_CALLS
create table if not exists public.model_calls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  provider text not null,
  model text not null,
  operation text not null,
  prompt_version text not null default '1.0.0',
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  image_count integer not null default 0 check (image_count >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  estimated_cost_usd double precision not null default 0.0 check (estimated_cost_usd >= 0.0),
  actual_cost_usd double precision null check (actual_cost_usd is null or actual_cost_usd >= 0.0),
  status text not null default 'success'
    check (status in ('success', 'failed', 'cancelled')),
  retry_count integer not null default 0 check (retry_count >= 0),
  error_code text null,
  created_at timestamptz not null default now(),
  foreign key (job_id, document_id)
    references public.processing_jobs(id, document_id) on delete cascade
);

-- 8. SUMMARY_VERSIONS
create table if not exists public.summary_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  job_id uuid not null,
  version integer not null default 1 check (version >= 1),
  format text not null default 'notion_markdown'
    check (format in ('notion_markdown', 'markdown', 'json')),
  content text not null,
  structure jsonb not null default '{}'::jsonb,
  status text not null default 'published'
    check (status in ('draft', 'published', 'superseded')),
  created_at timestamptz not null default now(),
  foreign key (job_id, document_id)
    references public.processing_jobs(id, document_id) on delete cascade,
  unique (id, document_id)
);

-- 9. SUMMARY_SOURCES
create table if not exists public.summary_sources (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  summary_version_id uuid not null,
  section_key text not null,
  paragraph_key text not null,
  block_id uuid not null,
  page_number integer not null check (page_number >= 1),
  contribution_type text not null default 'direct_quote' check (contribution_type in (
    'direct_quote', 'paraphrase', 'inference'
  )),
  confidence double precision not null default 1.0 check (confidence between 0.0 and 1.0),
  foreign key (summary_version_id, document_id)
    references public.summary_versions(id, document_id) on delete cascade,
  foreign key (block_id, document_id, page_number)
    references public.content_blocks(id, document_id, page_number) on delete cascade
);

-- 10. USER_CORRECTIONS
create table if not exists public.user_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  block_id uuid not null,
  original_text text not null,
  corrected_text text not null,
  correction_type text not null default 'visual_review' check (correction_type in (
    'visual_review', 'text_edit', 'structure_edit'
  )),
  created_at timestamptz not null default now(),
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade,
  foreign key (block_id, document_id)
    references public.content_blocks(id, document_id) on delete cascade
);

-- 11. USAGE_LEDGER
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid null,
  document_id uuid not null,
  job_id uuid not null,
  operation text not null,
  units integer not null default 1 check (units >= 1),
  cost_usd double precision not null default 0.0 check (cost_usd >= 0.0),
  credits_delta double precision not null default 0.0,
  created_at timestamptz not null default now(),
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade,
  foreign key (job_id, document_id)
    references public.processing_jobs(id, document_id) on delete cascade
);

-- 12. PROCESSING_CACHE
create table if not exists public.processing_cache (
  id uuid primary key default gen_random_uuid(),
  owner_scope text not null default 'user' check (owner_scope in ('user', 'system')),
  owner_id uuid null references auth.users(id) on delete cascade,
  cache_type text not null,
  cache_key text not null,
  model text not null,
  model_version text not null default '1.0.0',
  prompt_version text not null default '1.0.0',
  extractor_version text not null default '1.0.0',
  payload jsonb not null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  check (
    (owner_scope = 'user' and owner_id is not null)
    or (owner_scope = 'system' and owner_id is null)
  )
);

-- ============================================================================
-- INDICES
-- ============================================================================

create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_sha256_idx on public.documents(sha256);
create index if not exists document_pages_document_id_page_number_idx on public.document_pages(document_id, page_number);
create index if not exists content_blocks_document_id_idx on public.content_blocks(document_id);
create index if not exists content_blocks_page_id_idx on public.content_blocks(page_id);
create index if not exists content_blocks_stable_key_idx on public.content_blocks(stable_key);
create index if not exists block_relationships_document_id_idx on public.block_relationships(document_id);
create index if not exists block_relationships_source_document_idx on public.block_relationships(source_block_id, document_id);
create index if not exists block_relationships_target_document_idx on public.block_relationships(target_block_id, document_id);
create index if not exists processing_jobs_user_id_idx on public.processing_jobs(user_id);
create index if not exists processing_jobs_document_id_idx on public.processing_jobs(document_id);
create index if not exists processing_jobs_state_idx on public.processing_jobs(state);
create index if not exists job_events_job_id_sequence_idx on public.job_events(job_id, sequence);
create index if not exists model_calls_job_id_idx on public.model_calls(job_id);
create index if not exists model_calls_document_id_idx on public.model_calls(document_id);
create index if not exists summary_versions_document_id_idx on public.summary_versions(document_id);
create index if not exists summary_sources_summary_version_id_idx on public.summary_sources(summary_version_id);
create index if not exists summary_sources_block_document_page_idx on public.summary_sources(block_id, document_id, page_number);
create index if not exists user_corrections_user_id_document_id_idx on public.user_corrections(user_id, document_id);
create index if not exists user_corrections_block_document_idx on public.user_corrections(block_id, document_id);
create index if not exists usage_ledger_user_id_idx on public.usage_ledger(user_id);
create index if not exists usage_ledger_job_document_idx on public.usage_ledger(job_id, document_id);
create index if not exists processing_cache_cache_key_idx on public.processing_cache(cache_key);
create index if not exists processing_cache_owner_scope_owner_id_idx on public.processing_cache(owner_scope, owner_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) & POLICIES
-- ============================================================================

alter table public.documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.content_blocks enable row level security;
alter table public.block_relationships enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.job_events enable row level security;
alter table public.model_calls enable row level security;
alter table public.summary_versions enable row level security;
alter table public.summary_sources enable row level security;
alter table public.user_corrections enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.processing_cache enable row level security;

-- Documents RLS
drop policy if exists "Users manage own documents" on public.documents;
create policy "Users manage own documents"
  on public.documents for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Document Pages RLS
drop policy if exists "Users access own document pages" on public.document_pages;
create policy "Users access own document pages"
  on public.document_pages for all
  to authenticated
  using (document_id in (select id from public.documents where user_id = auth.uid()))
  with check (document_id in (select id from public.documents where user_id = auth.uid()));

-- Content Blocks RLS
drop policy if exists "Users access own content blocks" on public.content_blocks;
create policy "Users access own content blocks"
  on public.content_blocks for all
  to authenticated
  using (document_id in (select id from public.documents where user_id = auth.uid()))
  with check (document_id in (select id from public.documents where user_id = auth.uid()));

-- Block Relationships RLS
drop policy if exists "Users access own block relationships" on public.block_relationships;
create policy "Users access own block relationships"
  on public.block_relationships for all
  to authenticated
  using (document_id in (select id from public.documents where user_id = auth.uid()))
  with check (document_id in (select id from public.documents where user_id = auth.uid()));

-- Processing Jobs RLS
drop policy if exists "Users manage own processing jobs" on public.processing_jobs;
create policy "Users manage own processing jobs"
  on public.processing_jobs for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Job Events RLS
drop policy if exists "Users access own job events" on public.job_events;
create policy "Users access own job events"
  on public.job_events for all
  to authenticated
  using (job_id in (select id from public.processing_jobs where user_id = auth.uid()))
  with check (job_id in (select id from public.processing_jobs where user_id = auth.uid()));

-- Summary Versions RLS
drop policy if exists "Users access own summary versions" on public.summary_versions;
create policy "Users access own summary versions"
  on public.summary_versions for all
  to authenticated
  using (document_id in (select id from public.documents where user_id = auth.uid()))
  with check (document_id in (select id from public.documents where user_id = auth.uid()));

-- Summary Sources RLS
drop policy if exists "Users access own summary sources" on public.summary_sources;
create policy "Users access own summary sources"
  on public.summary_sources for all
  to authenticated
  using (document_id in (select id from public.documents where user_id = auth.uid()))
  with check (document_id in (select id from public.documents where user_id = auth.uid()));

-- User Corrections RLS
drop policy if exists "Users manage own corrections" on public.user_corrections;
create policy "Users manage own corrections"
  on public.user_corrections for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Model Calls RLS (Read-only for owner, insert/update reserved for service_role)
drop policy if exists "Users read own model calls" on public.model_calls;
create policy "Users read own model calls"
  on public.model_calls for select
  to authenticated
  using (document_id in (select id from public.documents where user_id = auth.uid()));

-- Usage Ledger RLS (Read-only for owner, insert/update reserved for service_role)
drop policy if exists "Users read own usage ledger" on public.usage_ledger;
create policy "Users read own usage ledger"
  on public.usage_ledger for select
  to authenticated
  using (user_id = auth.uid());

-- Processing Cache RLS
drop policy if exists "Users manage own processing cache" on public.processing_cache;
create policy "Users manage own processing cache"
  on public.processing_cache for all
  to authenticated
  using (owner_scope = 'user' and owner_id = auth.uid())
  with check (owner_scope = 'user' and owner_id = auth.uid());

-- Cache de sistema não recebe policy para authenticated; somente service_role o acessa.

-- Remove os grants amplos padrao do Supabase antes de conceder o minimo necessario.
revoke all privileges on table
  public.documents,
  public.document_pages,
  public.content_blocks,
  public.block_relationships,
  public.processing_jobs,
  public.job_events,
  public.model_calls,
  public.summary_versions,
  public.summary_sources,
  public.user_corrections,
  public.usage_ledger,
  public.processing_cache
from anon, authenticated;

-- Grant permissions to authenticated users
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_pages to authenticated;
grant select, insert, update, delete on public.content_blocks to authenticated;
grant select, insert, update, delete on public.block_relationships to authenticated;
grant select, insert, update, delete on public.processing_jobs to authenticated;
grant select, insert, update, delete on public.job_events to authenticated;
grant select on public.model_calls to authenticated;
grant select, insert, update, delete on public.summary_versions to authenticated;
grant select, insert, update, delete on public.summary_sources to authenticated;
grant select, insert, update, delete on public.user_corrections to authenticated;
grant select on public.usage_ledger to authenticated;
grant select, insert, update, delete on public.processing_cache to authenticated;

-- ============================================================================
-- STORAGE BUCKETS (PRIVADOS)
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('document-originals', 'document-originals', false, 52428800, array['application/pdf']),
  ('document-pages', 'document-pages', false, 10485760, array['image/jpeg', 'image/png']),
  ('document-regions', 'document-regions', false, 10485760, array['image/jpeg', 'image/png']),
  ('summary-exports', 'summary-exports', false, 10485760, array['text/markdown', 'application/json'])
on conflict (id) do nothing;

-- Storage Policies
create policy "Users manage own document-originals storage"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'document-originals' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'document-originals' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users manage own document-pages storage"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'document-pages' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'document-pages' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users manage own document-regions storage"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'document-regions' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'document-regions' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users manage own summary-exports storage"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'summary-exports' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'summary-exports' and auth.uid()::text = (storage.foldername(name))[1]);
