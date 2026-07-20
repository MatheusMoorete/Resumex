# Domínio de flashcards

## Arquitetura

- `domain/flashcards.ts`: contratos persistidos.
- `services/flashcardScheduler.ts`: adaptação mínima do `ts-fsrs`.
- `services/flashcardApi.ts`: REST/RPC Supabase; `localStorage` existe somente para mock E2E.
- `services/flashcardGenerator.ts`: gera rascunhos a partir do resumo.
- `components/FlashcardHome.tsx`: baralhos/cartões; `ReviewSession.tsx`: sessão; `CardEditor.tsx`: edição.
- Esquema e concorrência ficam em `supabase/migrations/202607190001_flashcards.sql`.

## Invariantes

- Não reimplemente FSRS. Converta datas na borda e mantenha `ts-fsrs` como fonte do agendamento.
- Uma revisão atualiza cartão e grava log atomicamente via `record_flashcard_review`.
- Preserve `version`/`p_expected_version`; ele impede sobrescrita por sessões concorrentes.
- Toda consulta Supabase depende de RLS por `auth.uid()`. Nunca substitua RLS por filtro apenas no cliente.
- Rascunhos vazios não são persistidos; frente e verso são aparados.
- Mock local nunca deve ativar em produção.

## Verificação

```powershell
npm.cmd run check:flashcards
npm.cmd run typecheck
npm.cmd run build
```

Se o formato persistido mudar, atualize tipo, API, RPC/migration e o script de verificação juntos.
