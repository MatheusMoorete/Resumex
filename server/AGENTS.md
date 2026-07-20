# Backend Express

Estas instruções valem para `server/`. O servidor é a fronteira de confiança; validação no frontend nunca substitui estas regras.

## Estrutura

- `index.js`: composição Express, headers, autenticação, allowlist, rate limit, roteamento de modelos, proxy de IA, Notion e SPA fallback.
- `summaryJobs.js`: criação/upload/polling de jobs, fila em memória, arquivos temporários e chamada do worker.
- `auth/authProvider.js`: seleciona o adaptador pelo ambiente.
- `auth/adapters/supabaseAuthProvider.js`: valida access token Supabase.
- Arquivos de `api/` são adaptadores finos de deploy e devem apontar para esta implementação, não duplicá-la.

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

## Verificação

```powershell
node --check server/index.js
node --check server/summaryJobs.js
npm.cmd run typecheck
```

Ao mudar endpoint, valide sem token, token não autorizado, payload inválido, rate limit e caminho feliz.
