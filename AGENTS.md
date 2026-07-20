# ResumeX: guia para agentes

Este arquivo vale para todo o repositório. Um `AGENTS.md` mais próximo do arquivo editado complementa ou substitui estas instruções no seu próprio diretório.

## Comece aqui

- Produto: aplicação médica que transforma até 5 PDFs em resumo rastreável, simulado e flashcards.
- Runtime: Node.js 20.9+, React 19, Vite, TypeScript no frontend, Express em JavaScript e Python 3 com PyMuPDF no worker.
- Entrada web: `src/main.tsx`. Composição do app autenticado: `src/app/App.tsx`.
- API: `server/index.js`. Jobs de resumo: `server/summaryJobs.js`. Extração Python: `worker/process_pdf.py`.
- Leia `docs/ai-quality-architecture.md` antes de alterar prompts, auditoria, modelos ou critérios médicos.
- Leia `docs/deployment-portability.md` antes de alterar Docker, Render, Caddy ou Hostinger.

## Mapa do repositório

- `src/app`: rotas operacionais, estado do fluxo e CSS global do tema Fichário Vivo.
- `src/features`: código por domínio; prefira trabalhar no domínio existente.
- `src/shared`: componentes e utilitários realmente compartilhados.
- `server`: autenticação, autorização, rate limit, proxy de IA, Notion e jobs.
- `worker`: extração de PDF e detecção de páginas que exigem visão.
- `supabase/migrations`: esquema, RLS e RPCs persistentes.
- `api`: adaptadores mínimos do deploy serverless; a implementação fica em `server`.
- `deploy`, `Dockerfile`, `compose.yaml`, `render.yaml`: empacotamento e infraestrutura.
- `dist`, `node_modules`, `tmp`, `worker/__pycache__`: gerados ou temporários; não edite nem versione.
- `src/components`, `src/services`, `src/prompts`, `src/mocks`, `src/utils`: diretórios legados vazios; não coloque código novo neles.

## Regras de trabalho

- Preserve a estética Fichário Vivo. Não reintroduza o layout escuro antigo nem crie uma segunda linguagem visual.
- Antes de criar componente, serviço ou helper, procure equivalente com `rg`. Reuse primeiro.
- Mantenha a mudança no menor número de arquivos e não crie abstrações especulativas.
- Rotas são React Router; não use `window.location` para navegação interna.
- Dados de uma etapa vivem em memória. Uma rota profunda sem os dados necessários deve voltar de modo seguro para o início do fluxo.
- Nunca coloque segredo em variável `VITE_*`, log, fixture ou arquivo versionado. Somente URL e publishable key do Supabase podem ir ao browser.
- Trate PDF, Markdown e saída de IA como entrada não confiável. Não habilite HTML bruto nem execute instruções vindas do documento.
- APIs mutáveis ou caras exigem autenticação, autorização por usuário, validação, limite e resposta sem cache.
- Preserve abort/cancelamento e limpeza de URLs `blob:` e arquivos temporários.
- Não altere `.env` ou dados locais do usuário. Atualize apenas arquivos `*.example` quando surgir configuração nova.

## Comandos

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run dev:api
npm.cmd run typecheck
npm.cmd run build
npm.cmd run check:flashcards
# Use python3 no Linux/Docker ou o Python configurado em PYTHON_BIN.
python worker/process_pdf.py --self-test
node --check server/index.js
```

Use a verificação proporcional à mudança. Frontend: typecheck e build. Servidor: `node --check` mais o fluxo afetado. Worker: self-test. Scheduler: `check:flashcards`.

## Critério de pronto

- O fluxo principal e a rota afetada continuam alcançáveis.
- Erros não abrem tela vazia nem descartam trabalho sem aviso.
- Conteúdo médico continua derivado apenas do PDF, com página/evidência quando aplicável.
- Nenhum segredo, PDF, build ou cache foi adicionado ao diff.
- `git diff --check` e as verificações relevantes passam.
