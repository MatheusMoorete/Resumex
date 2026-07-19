create table if not exists public.flashcard_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  desired_retention double precision not null default 0.90 check (desired_retention between 0.70 and 0.97),
  new_cards_per_day integer not null default 20 check (new_cards_per_day between 0 and 9999),
  max_reviews_per_day integer not null default 200 check (max_reviews_per_day between 1 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.flashcard_decks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  front text not null check (char_length(trim(front)) between 1 and 10000),
  back text not null check (char_length(trim(back)) between 1 and 20000),
  due timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  elapsed_days integer not null default 0,
  scheduled_days integer not null default 0,
  learning_steps integer not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  state smallint not null default 0 check (state between 0 and 3),
  last_review timestamptz,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcard_reviews (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.flashcards(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 4),
  state smallint not null check (state between 0 and 3),
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days integer not null,
  last_elapsed_days integer not null,
  scheduled_days integer not null,
  learning_steps integer not null default 0,
  reviewed_at timestamptz not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0)
);

create index if not exists flashcards_deck_due_idx on public.flashcards(deck_id, due);
create index if not exists flashcards_user_due_idx on public.flashcards(user_id, due);
create index if not exists flashcard_reviews_card_reviewed_idx on public.flashcard_reviews(card_id, reviewed_at desc);

alter table public.flashcard_decks enable row level security;
alter table public.flashcards enable row level security;
alter table public.flashcard_reviews enable row level security;

create policy "users manage own flashcard decks"
  on public.flashcard_decks for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users manage own flashcards"
  on public.flashcards for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.flashcard_decks deck
      where deck.id = deck_id and deck.user_id = auth.uid()
    )
  );

create policy "users read own flashcard reviews"
  on public.flashcard_reviews for select
  using (user_id = auth.uid());

create policy "users add own flashcard reviews"
  on public.flashcard_reviews for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.flashcards card
      where card.id = card_id and card.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.flashcard_decks to authenticated;
grant select, insert, update, delete on public.flashcards to authenticated;
grant select, insert on public.flashcard_reviews to authenticated;
grant usage, select on sequence public.flashcard_reviews_id_seq to authenticated;

create or replace function public.record_flashcard_review(
  p_card_id uuid,
  p_expected_version integer,
  p_next_card jsonb,
  p_review_log jsonb,
  p_duration_ms integer default null
)
returns public.flashcards
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_card public.flashcards;
begin
  update public.flashcards
  set
    due = (p_next_card->>'due')::timestamptz,
    stability = (p_next_card->>'stability')::double precision,
    difficulty = (p_next_card->>'difficulty')::double precision,
    elapsed_days = (p_next_card->>'elapsed_days')::integer,
    scheduled_days = (p_next_card->>'scheduled_days')::integer,
    learning_steps = coalesce((p_next_card->>'learning_steps')::integer, 0),
    reps = (p_next_card->>'reps')::integer,
    lapses = (p_next_card->>'lapses')::integer,
    state = (p_next_card->>'state')::smallint,
    last_review = (p_next_card->>'last_review')::timestamptz,
    version = version + 1,
    updated_at = now()
  where id = p_card_id
    and user_id = auth.uid()
    and version = p_expected_version
  returning * into updated_card;

  if updated_card.id is null then
    raise exception 'Card changed in another session. Reload and try again.' using errcode = '40001';
  end if;

  insert into public.flashcard_reviews (
    card_id, user_id, rating, state, due, stability, difficulty,
    elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
    reviewed_at, duration_ms
  ) values (
    updated_card.id,
    auth.uid(),
    (p_review_log->>'rating')::smallint,
    (p_review_log->>'state')::smallint,
    (p_review_log->>'due')::timestamptz,
    (p_review_log->>'stability')::double precision,
    (p_review_log->>'difficulty')::double precision,
    (p_review_log->>'elapsed_days')::integer,
    (p_review_log->>'last_elapsed_days')::integer,
    (p_review_log->>'scheduled_days')::integer,
    coalesce((p_review_log->>'learning_steps')::integer, 0),
    (p_review_log->>'review')::timestamptz,
    p_duration_ms
  );

  return updated_card;
end;
$$;

grant execute on function public.record_flashcard_review(uuid, integer, jsonb, jsonb, integer) to authenticated;
