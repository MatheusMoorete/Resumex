# Supabase e migrations

Migrations são cumulativas e devem funcionar em banco existente. Não reescreva migration já aplicada para corrigir produção; crie uma nova migration ordenada por timestamp.

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
