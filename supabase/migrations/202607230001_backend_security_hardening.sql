-- Hardening do schema legado ja presente no Supabase de producao.

-- As referencias compostas impedem vinculos entre registros de usuarios diferentes.
alter table public.flashcard_decks
  add constraint flashcard_decks_id_user_id_key unique (id, user_id);
alter table public.flashcards
  add constraint flashcards_id_user_id_key unique (id, user_id),
  add constraint flashcards_deck_user_fkey
    foreign key (deck_id, user_id)
    references public.flashcard_decks(id, user_id) on delete cascade;
alter table public.flashcard_reviews
  add constraint flashcard_reviews_card_user_fkey
    foreign key (card_id, user_id)
    references public.flashcards(id, user_id) on delete cascade;

alter table public.summaries
  add constraint summaries_id_user_id_key unique (id, user_id);
alter table public.quizzes
  add constraint quizzes_id_user_id_key unique (id, user_id),
  add constraint quizzes_summary_user_fkey
    foreign key (summary_id, user_id)
    references public.summaries(id, user_id) on delete set null (summary_id);
alter table public.quiz_attempts
  add constraint quiz_attempts_quiz_user_fkey
    foreign key (quiz_id, user_id)
    references public.quizzes(id, user_id) on delete cascade;

-- Remove a policy duplicada criada manualmente e limita as demais a usuarios autenticados.
drop policy if exists "Usuários gerenciam seus próprios resumos" on public.summaries;

alter policy "users manage own flashcard decks" on public.flashcard_decks to authenticated;
alter policy "users manage own flashcards" on public.flashcards to authenticated;
alter policy "users read own flashcard reviews" on public.flashcard_reviews to authenticated;
alter policy "users add own flashcard reviews" on public.flashcard_reviews to authenticated;
alter policy "users manage own summaries" on public.summaries to authenticated;
alter policy "users manage own quizzes" on public.quizzes to authenticated;
alter policy "users manage own quiz attempts" on public.quiz_attempts to authenticated;

-- O Supabase concedeu ALL por padrao, inclusive TRUNCATE. Reaplica o minimo necessario.
revoke all privileges on table
  public.flashcard_decks,
  public.flashcards,
  public.flashcard_reviews,
  public.summaries,
  public.quizzes,
  public.quiz_attempts
from anon, authenticated;

grant select, insert, update, delete on table
  public.flashcard_decks,
  public.flashcards,
  public.summaries,
  public.quizzes,
  public.quiz_attempts
to authenticated;
grant select, insert on table public.flashcard_reviews to authenticated;

revoke all privileges on sequence public.flashcard_reviews_id_seq from anon, authenticated;
grant usage, select on sequence public.flashcard_reviews_id_seq to authenticated;

revoke all privileges on function public.record_flashcard_review(uuid, integer, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.record_flashcard_review(uuid, integer, jsonb, jsonb, integer)
  to authenticated;
