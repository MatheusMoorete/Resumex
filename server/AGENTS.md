# Backend Express

Estas instruções valem para `server/`. O servidor é a fronteira de confiança; validação no frontend nunca substitui estas regras.

## Estrutura Modular Agent-First

- `index.js`: Ponto de entrada enxuto que inicializa o escutador HTTP na porta configurada.
- `src/app.js`: Composição da aplicação Express, registro de middlewares globais, rotas e fallback SPA.
- `src/config/env.js`: Variáveis de ambiente, URLs dos provedores, modelos de IA e constantes globais.
- `src/middlewares/`:
  - `auth.js`: Autenticação Supabase, tokens Bearer e `requireAuth`.
  - `security.js`: Headers de segurança (nosniff, HSTS, CSP), utilitários locais e handler de JSON inválido.
  - `rateLimit.js`: Algoritmo de rate limit por IP/cliente.
- `src/routes/`:
  - `health.js`: Endpoints `/api/health`, `/api/auth/*` e `/api/config`.
  - `aiProxy.js`: Orquestrador de IA, seleção de modelos/auditores e proxy para DeepSeek/OpenAI/Kimi.
  - `notion.js`: Exportador e conversor de Markdown para blocos da API do Notion.
- `src/schemas/`: Validation Schemas Zod em runtime para payloads de API.
- `summaryJobs.js`: Criação/upload/polling de jobs, fila em memória e worker PDF.
- `quizJobs.ts`: upload/polling/cancelamento de simulados, worker PDF e orquestração server-side.
- `auth/`: Adaptadores de autenticação (Supabase / Mock).

## Segurança obrigatória

- Todo endpoint caro, privado ou mutável usa `requireAuth` e rate limit.
- Autorize recursos por `req.authUser.id`; um ID válido não implica propriedade.
- Produção falha ao iniciar sem auth configurada ou `ALLOWED_EMAILS`.
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
node --check server/index.js
node --check server/src/app.js
npm run test
npm run typecheck
```

Ao mudar endpoint, valide sem token, token não autorizado, payload inválido, rate limit e caminho feliz.
