# Domínio de simulado

## Onde mexer

- `components/QuizUpload.tsx`: arquivos e opções; a detecção visual acontece automaticamente no servidor.
- `components/QuizProcessingTimeline.tsx`: progresso.
- `components/QuizView.tsx`: execução, resultado e novas variantes.
- `services/quizJobApi.ts`: upload autenticado, início, polling e cancelamento do job.
- `services/quizApi.ts`: lógica reutilizada pelo servidor para classificação, extração, geração, localização de evidência e auditoria.
- `server/quizJobs.ts`: limites, fila, worker PDF, leitura visual e chamadas internas aos provedores.

## Invariantes

- Cada questão entregue precisa de arquivo, página e `evidenceQuote` literal localizável no corpus.
- Valores, unidades e comparadores exigem correspondência literal; aproximação semântica não basta.
- Questão reprovada não completa a quantidade pedida.
- Auditoria usa apenas a evidência fornecida e provedor independente quando exigido.
- Bancos de questões servem como referência de estilo ou fonte de questões conforme a opção escolhida; não misture os modos silenciosamente.
- Não corte parágrafos ao montar blocos quando houver alternativa simples e distribua amostras pelo corpus inteiro.
- Preserve cancelamento via `AbortSignal` em chamadas novas.
- Geração e auditoria não podem voltar ao proxy público; somente o job server-side escolhe papéis, modelos e orçamentos.

## Verificação

Execute `npm.cmd run typecheck` e `npm.cmd run build`. Em alterações no pipeline, valide ao menos um arquivo de teoria, um banco de questões e o caminho sem evidência válida.
