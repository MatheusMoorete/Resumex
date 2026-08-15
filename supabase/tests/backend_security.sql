-- Execute como postgres depois das migrations. O bloco falha na primeira regressao.
do $$
declare
  expected_constraints text[] := array[
    'flashcard_decks_id_user_id_key',
    'flashcards_id_user_id_key',
    'flashcards_deck_user_fkey',
    'flashcard_reviews_card_user_fkey',
    'summaries_id_user_id_key',
    'quizzes_id_user_id_key',
    'quizzes_summary_user_fkey',
    'quiz_attempts_quiz_user_fkey'
  ];
begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name in (
        'flashcard_decks', 'flashcards', 'flashcard_reviews',
        'summaries', 'quizzes', 'quiz_attempts'
      )
  ) then
    raise exception 'anon ainda possui privilegios nas tabelas de estudo';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and table_name in (
        'flashcard_decks', 'flashcards', 'flashcard_reviews',
        'summaries', 'quizzes', 'quiz_attempts'
      )
      and not (
        privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        and (table_name <> 'flashcard_reviews' or privilege_type in ('SELECT', 'INSERT'))
      )
  ) then
    raise exception 'authenticated possui privilegios alem do contrato';
  end if;

  if (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'authenticated'
      and table_name in (
        'flashcard_decks', 'flashcards', 'flashcard_reviews',
        'summaries', 'quizzes', 'quiz_attempts'
      )
  ) <> 22 then
    raise exception 'grants necessarios de authenticated estao incompletos';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'flashcard_decks', 'flashcards', 'flashcard_reviews',
        'summaries', 'quizzes', 'quiz_attempts'
      )
      and roles::text <> '{authenticated}'
  ) then
    raise exception 'policy de estudo ainda se aplica a um role diferente de authenticated';
  end if;

  if (
    select count(distinct conname)
    from pg_constraint
    where conname = any(expected_constraints)
  ) <> cardinality(expected_constraints) then
    raise exception 'constraints multi-tenant do schema legado estao incompletas';
  end if;

  if exists (
    select 1 from public.flashcards c
    join public.flashcard_decks d on d.id = c.deck_id
    where c.user_id <> d.user_id
  ) or exists (
    select 1 from public.flashcard_reviews r
    join public.flashcards c on c.id = r.card_id
    where r.user_id <> c.user_id
  ) or exists (
    select 1 from public.quizzes q
    join public.summaries s on s.id = q.summary_id
    where q.user_id <> s.user_id
  ) or exists (
    select 1 from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
    where a.user_id <> q.user_id
  ) then
    raise exception 'foram encontradas referencias entre usuarios';
  end if;
end
$$;
