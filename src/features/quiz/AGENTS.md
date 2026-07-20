# Domínio de simulado

## Onde mexer

- `components/QuizUpload.tsx`: arquivos e opções.
- `components/QuizProcessingTimeline.tsx`: progresso.
- `components/QuizView.tsx`: execução, resultado e novas variantes.
- `services/quizApi.ts`: classificação, extração, geração, localização de evidência e auditoria.

## Invariantes

- Cada questão entregue precisa de arquivo, página e `evidenceQuote` literal localizável no corpus.
- Valores, unidades e comparadores exigem correspondência literal; aproximação semântica não basta.
- Questão reprovada não completa a quantidade pedida.
- Auditoria usa apenas a evidência fornecida e provedor independente quando exigido.
- Bancos de questões servem como referência de estilo ou fonte de questões conforme a opção escolhida; não misture os modos silenciosamente.
- Não corte parágrafos ao montar blocos quando houver alternativa simples e distribua amostras pelo corpus inteiro.
- Preserve cancelamento via `AbortSignal` em chamadas novas.

## Verificação

Execute `npm.cmd run typecheck` e `npm.cmd run build`. Em alterações no pipeline, valide ao menos um arquivo de teoria, um banco de questões e o caminho sem evidência válida.
