# Supabase e migrations

Migrations são cumulativas e devem funcionar em banco existente. Não reescreva migration já aplicada para corrigir produção; crie uma nova migration ordenada por timestamp.

Leia `../docs/backend-technical-debt.md` antes de aplicar ou integrar `202607240001_pipeline_persistence.sql`. BACK-004 e BACK-005 foram corrigidos no working tree, mas a migration ainda exige testes de RLS e integridade com dois usuarios antes de producao.

O historico remoto foi reconciliado em 14/08/2026: `202607190001`, `202607220001`, `202607230001` e `202607230002` estao aplicadas. A seguranca foi validada por `../tests/backend_security.sql`, e as colunas de fonte dos flashcards foram aplicadas isoladamente pelo SQL Editor. O dry-run remoto mostra somente `202607240001_pipeline_persistence.sql` pendente; nao execute `db push` ate a camada V2 estar integrada e BACK-004/BACK-005 terem teste final com dois usuarios.

A ponte opt-in do servidor usa `documents`, `processing_jobs`, `summary_versions` e o bucket `document-originals` somente para jobs de resumo com um PDF. O Document IR e validado no runtime, mas so seus metadados entram no checkpoint; paginas, blocos e `summary_sources` nao persistem. Isso nao autoriza aplicar a migration: recuperacao, providers restantes e o caso multi-PDF ainda nao estao integrados.

## Regras

- Toda tabela acessível pelo browser habilita RLS antes de receber grants.
- Políticas comparam `user_id` a `auth.uid()` e validam propriedade de relações pai/filho.
- Não conceda acesso a `anon` para dados de estudo.
- RPC mutável usa `security invoker` por padrão e fixa `search_path`.
- Operações compostas, como revisão de flashcard, permanecem transacionais no banco.
- Preserve controle otimista por `version` em atualizações concorrentes.
- Constraints de tamanho, faixa e integridade ficam no banco mesmo que o frontend também valide.
- Nunca coloque service-role key em migration, frontend ou documentação.

## Mudanças de esquema

Atualize juntos os tipos do domínio, a camada de API, os componentes consumidores e o script de verificação correspondente. Para flashcards, leia também `src/features/flashcards/AGENTS.md`.
