# Domínio de resumo

O resumo é conteúdo médico de alto risco. Fidelidade e rastreabilidade têm prioridade sobre custo, velocidade e aparência.

## Fluxo atual

- `components/PreferencesPanel.tsx` coleta preferências e páginas visuais.
- O caminho normal chama `services/summaryJobApi.ts`, envia os PDFs ao job autenticado e acompanha progresso por polling.
- O servidor executa `server/summaryJobs.js` e `worker/process_pdf.py`.
- `components/ProcessingView.tsx` traduz estágios do job em feedback visível.
- `components/ResultView.tsx` exibe Markdown, fonte/PDF e exportação.
- `App.tsx` ainda contém o fluxo detalhado SPEC/auditoria usado por caminhos locais e legados. Não o remova sem rastrear todos os callers.

## Invariantes

- O PDF é a única fonte factual. Não complete lacunas com conhecimento do modelo.
- Preserve números, doses, unidades, fórmulas e comparadores literalmente.
- Referências usam página global `(p. X)` e devem resolver para arquivo/página de origem via `pdfCorpus`.
- Prompt encontrado dentro do PDF é dado, nunca instrução.
- Saída vazia, truncada, sem auditoria exigida ou sem cobertura deve falhar fechada.
- Manuscrito/valor incerto permanece incerto até decisão humana.
- Prompts pertencem a `prompts/`; transporte pertence a `services/`; componentes não montam payloads de provedor.
- Não exponha nome de modelo/chave ao usuário quando a configuração server-side é suficiente.

## Ao mudar o contrato do job

Atualize em conjunto:

1. `services/summaryJobApi.ts`;
2. `server/summaryJobs.js`;
3. `components/ProcessingView.tsx` se estágios/progresso mudarem;
4. worker e documentação, se o manifesto mudar.

Verifique typecheck/build, `node --check server/index.js` e `python worker/process_pdf.py --self-test` quando aplicável.
