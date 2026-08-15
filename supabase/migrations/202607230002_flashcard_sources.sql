begin;

alter table public.flashcards
  add column if not exists source_type text,
  add column if not exists source_name text,
  add column if not exists source_page integer,
  add column if not exists evidence_quote text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flashcards_source_type_check' and conrelid = 'public.flashcards'::regclass) then
    alter table public.flashcards add constraint flashcards_source_type_check
      check (source_type is null or source_type in ('summary', 'external_text', 'pdf'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_source_name_length_check' and conrelid = 'public.flashcards'::regclass) then
    alter table public.flashcards add constraint flashcards_source_name_length_check
      check (source_name is null or char_length(source_name) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_source_page_check' and conrelid = 'public.flashcards'::regclass) then
    alter table public.flashcards add constraint flashcards_source_page_check
      check (source_page is null or source_page between 1 and 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_evidence_quote_length_check' and conrelid = 'public.flashcards'::regclass) then
    alter table public.flashcards add constraint flashcards_evidence_quote_length_check
      check (evidence_quote is null or char_length(evidence_quote) between 20 and 2000);
  end if;
end
$$;

commit;
