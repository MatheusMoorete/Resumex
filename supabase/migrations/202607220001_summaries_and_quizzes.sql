-- Migration: Resumos e Simulados com RLS no Supabase

-- 1. Tabela de Resumos Médicos
create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  content text not null,
  template_type text not null default 'general',
  source_file_name text,
  content_hash text,
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Tabela de Simulados / Quizzes
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  summary_id uuid references public.summaries(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  questions jsonb not null,
  created_at timestamptz not null default now()
);

-- 3. Tabela de Tentativas / Histórico de Simulados
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  score double precision not null check (score between 0 and 100),
  answers jsonb not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  completed_at timestamptz not null default now()
);

-- Índices de performance por Usuário
create index if not exists summaries_user_created_idx on public.summaries(user_id, created_at desc);
create index if not exists summaries_content_hash_idx on public.summaries(content_hash);
create index if not exists quizzes_user_created_idx on public.quizzes(user_id, created_at desc);
create index if not exists quiz_attempts_quiz_completed_idx on public.quiz_attempts(quiz_id, completed_at desc);
create index if not exists quiz_attempts_user_completed_idx on public.quiz_attempts(user_id, completed_at desc);

-- Habilitar Row Level Security (RLS)
alter table public.summaries enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;

-- Políticas de RLS para Resumos
create policy "users manage own summaries"
  on public.summaries for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Políticas de RLS para Simulados
create policy "users manage own quizzes"
  on public.quizzes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Políticas de RLS para Tentativas de Simulados
create policy "users manage own quiz attempts"
  on public.quiz_attempts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Permissões para usuários autenticados
grant select, insert, update, delete on public.summaries to authenticated;
grant select, insert, update, delete on public.quizzes to authenticated;
grant select, insert, update, delete on public.quiz_attempts to authenticated;
