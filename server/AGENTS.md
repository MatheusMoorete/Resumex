# Backend Express

Estas instruções valem para `server/`. O servidor é a fronteira de confiança; validação no frontend nunca substitui estas regras.

## Estrutura Modular Agent-First

- Leia `../docs/backend-technical-debt.md` antes de alterar jobs, worker, persistência ou providers. Não confunda módulos preparados com o runtime ativo.
- `index.ts`: Ponto de entrada enxuto que inicializa o escutador HTTP na porta configurada.
- `src/app.ts`: Composição da aplicação Express, registro de middlewares globais, rotas e fallback SPA.
- `src/config/env.ts`: Variáveis de ambiente, URLs dos provedores, modelos de IA e constantes globais.
- `src/middlewares/`:
  - `auth.ts`: Autenticação Supabase, tokens Bearer e `requireAuth`.
  - `security.ts`: Headers de segurança, utilitários locais e handler de JSON inválido.
  - `rateLimit.ts`: Rate limit e limite de concorrência locais ao processo.
- `src/routes/`:
  - `health.ts`: Endpoints `/api/health`, `/api/auth/*` e `/api/config`.
  - `aiProxy.ts`: Seleção de modelos/auditores e proxies de IA.
  - `notion.ts`: Exportador e conversor de Markdown para blocos da API do Notion.
- `src/schemas/`: Validation Schemas Zod em runtime para payloads de API.
- `summaryJobs.ts`: Criação/upload/polling de jobs, fila em memória e worker PDF.
- `quizJobs.ts`: upload/polling/cancelamento de simulados, worker PDF e orquestração server-side.
- `auth/`: Adaptadores de autenticação (Supabase / Mock).

### Estado da migração V2

- O caminho ativo ainda é `summaryJobs.ts`/`quizJobs.ts` -> protocolo legado de `worker/process_pdf.py`.
- `summaryJobs.ts` já importa a ponte mínima de `src/repositories/` para persistir o original e o lifecycle de jobs com exatamente um PDF quando `SUMMARY_PIPELINE_PERSISTENCE_ENABLED=true`.
- A flag fica desligada por padrão e exige `SUPABASE_SERVICE_ROLE_KEY`; chave publishable nunca pode substituir a service role.
- Jobs com 2 a 5 PDFs continuam integralmente legados porque `processing_jobs.document_id` representa um único documento. Não grave um conjunto multi-PDF nesse campo.
- Sob a mesma flag, um PDF usa a CLI nova do worker, valida `DocumentIRSchema` e grava somente `schema_version`, `source_hash` e `page_count` no checkpoint. Um adaptador pequeno alimenta a síntese legada.
- Não grave páginas/blocos do IR com inserts parciais: antes disso, defina transação ou upsert idempotente e teste retry.
- A síntese opt-in usa `AIRouter.summary.generateSection`, valida schema, claims e cobertura; truncamento falha fechado. O resultado usa o mesmo UUID do job em `summary_versions` para retry idempotente.
- Planning/vision providers V2, checkpoints recuperáveis, páginas/blocos e `summary_sources` ainda não participam do caminho ativo.
- Não declare persistência, checkpoints ou providers V2 como entregues até existir integração de ponta a ponta.

## Segurança obrigatória

- Todo endpoint caro, privado ou mutável usa `requireAuth` e rate limit.
- Autorize recursos por `req.authUser.id`; um ID válido não implica propriedade.
- Produção deve falhar ao iniciar sem auth configurada ou `ALLOWED_EMAILS`; o runtime atual ainda não cumpre a segunda parte (BACK-010).
- E2E mock exige ambiente não produtivo e socket realmente local. Não confie em `Host` ou query string.
- Chaves de provedor ficam em env server-side. Nunca devolva segredo em `/api/config`, logs ou erros.
- O proxy genérico aceita somente provedores conhecidos, `Bearer` e `chat/completions`.
- Valide forma, tamanho e magic bytes de uploads antes de gravar.
- Respostas `/api` usam `Cache-Control: no-store`; preserve headers de segurança e HSTS de produção.
- Não logue corpo de PDF, prompt completo, token ou conteúdo médico. Métricas podem registrar papel, modelo, tokens, duração e status.
- Sempre aplique timeout/abort a upstreams e finalize streams sem deixar request pendurado.

## Jobs de resumo

- Máximo atual: 5 PDFs, 50 MB cada, 300 páginas no worker.
- Jobs pertencem a um usuário e expiram da memória após conclusão/falha.
- Arquivos ficam sob diretório aleatório em `os.tmpdir()` e são removidos no `finally`.
- A fila global serial é decisão consciente; só introduza fila externa quando concorrência real justificar.
- `publicJob` é a lista permitida de campos devolvidos. Não exponha paths internos, prompts ou objetos de provedor.

## Jobs de simulado

- Aceitam somente 15, 30 ou 45 questões, um job ativo e três criações/inícios por hora por usuário.
- A leitura visual é automática, limitada a 30 páginas; geração e auditoria são papéis internos, não acessíveis pelo proxy público.
- PDFs e imagens temporárias são removidos assim que o job termina, falha ou é cancelado.

## Verificação

```powershell
npm run test
npm run typecheck
python -m unittest discover -s worker -p "test_*.py"
```

Ao mudar endpoint, valide sem token, token não autorizado, payload inválido, rate limit e caminho feliz.
