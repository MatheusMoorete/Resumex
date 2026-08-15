# Dívida técnica do backend

Data da linha de base: 06/08/2026
Status: inventario ativo; BACK-001 a BACK-005 corrigidos localmente; BACK-006 em integracao incremental; BACK-020 e BACK-021 corrigidos e validados no Supabase remoto
Escopo: `server/`, `worker/`, `supabase/migrations/`, `api/` e contratos de deploy relacionados

## Como usar este documento

Este inventario descreve o *working tree* auditado, inclusive arquivos ainda nao
versionados. Ele separa o fluxo realmente montado pelo Express de modulos que ja
existem, mas ainda nao participam da execucao. Documentos de proposta ou de
implementacao nao substituem uma importacao a partir de `server/src/app.ts` ou dos
jobs ativos.

Antes de alterar o backend:

1. leia o `AGENTS.md` da raiz e o mais proximo do arquivo;
2. encontre o item `BACK-*` afetado aqui;
3. preserve os invariantes medicos de `docs/ai-quality-architecture.md`;
4. atualize evidencia, status e criterio de pronto no mesmo pull request da correcao.

Prioridades:

- **P0**: bloqueia o fluxo, um deploy limpo ou a seguranca de dados;
- **P1**: risco alto de perda, resultado incorreto, indisponibilidade ou isolamento;
- **P2**: risco operacional/manutencao relevante;
- **P3**: deriva documental ou simplificacao desejavel.

## Arquitetura observada

### Caminho ativo

1. `server/src/app.ts` monta `summaryJobs.ts` e `quizJobs.ts`.
2. Os dois jobs guardam estado em `Map`, encadeiam uma fila `Promise` local e
   chamam `worker/process_pdf.py` pelo protocolo legado.
3. O resumo chama GLM/DeepSeek por um cliente proprio em `summaryJobs.ts`.
4. O simulado reutiliza `src/features/quiz/services/quizApi.ts` e parte do
   roteamento de `server/src/routes/aiProxy.ts`.
5. O mesmo job de simulado aceita PDFs ou um resumo como corpus exclusivo; questões
   continuam exigindo trecho literal verificável e auditor independente.
6. Resumos mantêm referências `(p. X)` no armazenamento; a limpeza ocorre somente
   nas exportações que pedem Markdown sem marcadores internos.
7. Estado, resultados e limites operacionais do pipeline vivem no processo.

### Caminho preparado ou parcialmente integrado

- `server/src/ai/`, os schemas de IA e `AIRouter`;
- `server/src/schemas/documentIr.ts`;
- o protocolo novo do worker que grava um `Document IR` em `--output`;
- `supabase/migrations/202607240001_pipeline_persistence.sql`.

`summaryJobs.ts` agora usa `getSupabaseAdminClient`, repositories e
`DocumentIRSchema` por uma ponte opt-in. Com
`SUMMARY_PIPELINE_PERSISTENCE_ENABLED=true`, jobs com exatamente um PDF salvam o
original em `document-originals`, espelham o lifecycle em `documents` e
`processing_jobs`, executam a CLI nova, validam o Document IR, usam o provider de
resumo com schema e gravam `summary_versions`. Somente metadados do IR entram no
checkpoint; paginas/blocos/fontes ainda nao persistem. A flag fica desligada por
padrao; multi-PDF, providers V2 restantes e recuperacao continuam inativos. Nao
trate a camada V2 como entregue ate existir integracao de ponta a ponta e teste real
de RLS.

## Resumo priorizado

| ID | Prioridade | Area | Sintoma principal |
| --- | --- | --- | --- |
| BACK-001 | P0 | Worker/Jobs | **Corrigido:** `stdout` legado voltou a ser um JSON unico |
| BACK-002 | P0 | Worker/Qualidade | **Corrigido:** todos os PDFs e modos de visao entram no contrato legado |
| BACK-003 | P0 | Deploy Python | **Corrigido:** Pydantic foi declarado em `requirements.txt` |
| BACK-004 | P0 | Supabase/RLS | **Corrigido localmente:** cache `system` ficou exclusivo do `service_role`; falta teste remoto |
| BACK-005 | P1 | Supabase/Integridade | **Corrigido localmente:** FKs compostas fecham referencias entre tenants; falta teste remoto |
| BACK-006 | P1 | Arquitetura | **Em andamento:** um PDF chega a resultado persistido; recuperação e restante pendentes |
| BACK-007 | P1 | Privacidade | PDFs temporarios de resumo nao sao removidos ao terminar o job |
| BACK-008 | P1 | Qualidade medica | **Em andamento:** saída V2 de um PDF validada; legado continua livre |
| BACK-009 | P1 | Cobertura | citar uma pagina basta para ela ser considerada coberta; reparo vira apendice |
| BACK-010 | P1 | Autorizacao | `ALLOWED_EMAILS` vazio transforma qualquer autenticado em administrador de metricas |
| BACK-011 | P2 | Operacao | filas, limites e telemetria sao locais ao processo e parcialmente sem limpeza |
| BACK-012 | P2 | Config/Health | configuracao nao e validada e `/health` nao mede prontidao real |
| BACK-013 | P2 | Seguranca | erros internos e de upstream podem ser devolvidos diretamente ao cliente |
| BACK-014 | P2 | TypeScript | `strict` esta desligado e fronteiras criticas usam `any` |
| BACK-015 | P2 | Testes | suites passam, mas nao cobrem o protocolo realmente usado pelos jobs nem RLS |
| BACK-016 | P2 | Deploy | adaptadores Vercel nao cobrem jobs e o modelo em memoria nao e serverless-safe |
| BACK-017 | P2 | Memoria | uploads de ate 50 MB sao materializados integralmente no heap do Express |
| BACK-018 | P3 | Organizacao | orquestracao duplicada e codigo server-side dependente de modulo do frontend |
| BACK-019 | P3 | Documentacao | indices, comandos e documentos descrevem arquivos/estados que nao existem no runtime |
| BACK-020 | P0 | Supabase/Grants | **Corrigido no remoto:** grants minimos; `anon` sem acesso e policies em `authenticated` |
| BACK-021 | P1 | Supabase/Integridade | **Corrigido no remoto:** FKs compostas impedem referencias entre usuarios |
| BACK-022 | P1 | Supabase/Auth | protecao contra senhas vazadas esta desabilitada |

## Registros detalhados

### BACK-001 - Protocolo legado do worker invalido

**Status:** corrigido e validado localmente em 06/08/2026.

**Correcao**

- [`summaryJobs.ts`](../server/summaryJobs.ts#L669) e
  [`quizJobs.ts`](../server/quizJobs.ts#L308) executam o worker no modo legado e
  aplicam `JSON.parse(stdout)`.
- [`legacy_process`](../worker/process_pdf.py#L477) usa `redirect_stdout` da stdlib
  para enviar eventos e avisos ao `stderr`; apenas o JSON final permanece em
  `stdout`.
- O teste `test_legacy_cli_keeps_stdout_parseable_and_processes_all_files` executa a
  CLI real e faz parse direto da saida.

**Risco**

Todo resumo ou simulado que chega ao worker pode falhar antes da primeira chamada de
IA. O teste do protocolo novo nao detecta a regressao do consumidor legado.

**Validacao**

- protocolo legado: JSON unico em `stdout`, diagnostico em `stderr`;
- protocolo Document IR: eventos em `stdout` e resultado no arquivo `--output`;
- teste de regressao passou na suite Python.

### BACK-002 - Multi-PDF e preferencias de visao quebrados

**Status:** corrigido e validado localmente em 06/08/2026.

**Correcao**

- [`legacy_process`](../worker/process_pdf.py#L477) percorre todos os arquivos,
  preserva `sourceIndex`/`sourcePage` e calcula pagina global.
- `should_use_vision` centraliza `off`, `auto`, `all` e `manual` sem dependencia nova.
- limites de 300 paginas totais e de paginas visuais voltaram a ser independentes.

**Risco**

Conteudo medico pode ser silenciosamente omitido e uma escolha explicita do usuario
pode ser ignorada. A numeracao global e os `sourceIndex` tambem deixam de representar
o conjunto enviado.

**Validacao**

- teste de CLI com dois PDFs valida ambos os textos, indices, paginas e modo manual;
- teste unitario cobre os quatro modos de visao.

### BACK-003 - Ambiente Python nao reproduzivel

**Status:** corrigido no manifesto; smoke de container limpo ainda pertence ao
BACK-015.

**Correcao**

- [`document_ir.py`](../worker/document_ir.py#L9) e
  [`page_analysis.py`](../worker/page_analysis.py#L11) importam Pydantic v2; o
  worker principal depende desses modulos.
- [`requirements.txt`](../requirements.txt) declara PyMuPDF e `pydantic>=2,<3`.
- O Docker instala apenas esse arquivo de requisitos antes de iniciar o servidor.

**Risco**

Uma imagem limpa sobe o Node, mas o primeiro job falha ao importar o worker.

**Validacao**

- todas as dependencias atuais de runtime estao declaradas por faixa compativel;
- as 25 verificacoes Python passam; falta apenas automatizar o smoke limpo.

### BACK-004 - Cache `system` gravavel por qualquer usuario

**Status: corrigido na migration ainda nao aplicada; validacao no banco pendente.**

**Evidencia**

- A versao auditada inicialmente permitia `owner_scope = 'system' OR owner_id =
  auth.uid()` em `USING` e `WITH CHECK`.
- A migration local agora exige `owner_scope = 'user' AND owner_id = auth.uid()`.
  Registros `system` exigem `owner_id IS NULL` e nao possuem policy para
  `authenticated`; ficam reservados ao `service_role`, que ignora RLS.

**Risco**

Um usuario autenticado pode ler, envenenar ou apagar entradas globais. Se o payload
contiver dados derivados de PDF, tambem ha risco de vazamento entre tenants.

**Pronto quando**

- [x] cache de usuario exige `owner_scope = 'user' AND owner_id = auth.uid()`;
- [x] cache de sistema e exclusivo do backend/service role;
- [ ] testes SQL provam leitura e mutacao permitidas/proibidas para dois usuarios.

Na primeira inspecao de 09/08/2026 o dashboard informava `No migrations` e nao
possuia as tabelas V2. O historico legado foi reconciliado depois; a migration V2
continua pendente e nao deve ser aplicada antes do teste de RLS.

### BACK-005 - Integridade multi-tenant incompleta na migration V2

**Status: corrigido na migration ainda nao aplicada; validacao no banco pendente.**

**Evidencia**

- A versao auditada inicialmente usava FKs independentes, que nao provavam que
  pagina, bloco, job, resumo e usuario pertenciam ao mesmo documento.
- A migration local agora usa FKs compostas em toda essa cadeia. `summary_sources`
  recebeu `document_id` para correlacionar a versao, o bloco e a pagina no banco.
- Estados e tipos definidos pelo contrato atual receberam `CHECK` de dominio.

**Risco**

Referencias cruzadas podem corromper proveniencia, produzir cascatas inesperadas e,
se um UUID for conhecido, atravessar o isolamento logico mesmo com RLS habilitado.

**Pronto quando**

- [x] FKs compostas garantem a cadeia usuario -> documento -> pagina -> bloco ->
  resumo/job;
- [x] estados e tipos definidos no contrato atual possuem dominios validos;
- [ ] testes de banco tentam referencias cruzadas entre dois usuarios.

### BACK-006 - Migracao arquitetural incompleta

**Status: em andamento; primeiro corte local validado em 09/08/2026.**

**Evidencia**

- [`app.ts`](../server/src/app.ts#L12) monta os jobs antigos.
- [`summaryJobs.ts`](../server/summaryJobs.ts#L35) e
  [`quizJobs.ts`](../server/quizJobs.ts#L25) ainda usam `Map` e fila `Promise`.
- O resumo importa uma ponte minima de repositories: sob flag, um PDF e o estado do
  job sao persistidos. O mesmo UUID identifica o job em RAM e `processing_jobs`.
- A mesma fatia executa o protocolo novo do worker, valida `DocumentIRSchema` e
  adapta os blocos para a sintese atual. `schema_version`, `source_hash` e
  `page_count` ficam no checkpoint.
- A sintese opt-in chama `AIRouter.summary`, valida schema/claims/cobertura, rejeita
  truncamento e persiste o Markdown em `summary_versions` com ID deterministico.
- O corte e deliberadamente limitado a um PDF porque o schema V2 liga cada job a um
  unico `document_id`; 2 a 5 PDFs permanecem no legado para nao criar uma relacao
  falsa no banco.
- Planning/vision V2, paginas/blocos/fontes persistidos e recuperacao apos restart
  ainda nao sao usados pela rota ativa.
- `contentHash` e calculado no resumo, mas nao existe consulta de cache server-side.

**Risco**

Restart perde jobs e resultados; checkpoints, idempotencia, cache e rastreabilidade
prometidos nao existem no runtime. Documentacao pode induzir uma LLM a alterar a
camada inativa supondo que corrigiu producao.

**Pronto quando**

- o caminho ativo usar uma unica representacao e uma unica camada de providers;
- estado/checkpoints sobreviverem a restart e cada recurso for autorizado por
  usuario;
- modulos substituidos forem removidos, sem manter duas implementacoes permanentes.

**Validacao do corte atual**

- chave publishable nao cria cliente admin; a service role e obrigatoria;
- falha ao inserir metadata remove o objeto que acabou de ser enviado ao Storage;
- repository preserva o UUID do job ativo e atualiza seu lifecycle;
- a CLI real gera Document IR, o Node valida o schema e o adaptador preserva pagina,
  texto, bbox normalizada e preview visual;
- provider mock prova claims e cobertura por duas paginas; provider real simulado
  prova falha fechada em `finish_reason=length`;
- resultado final usa upsert idempotente em `summary_versions`;
- testes focados e typecheck passam, sem acesso ao Supabase remoto.

Nao introduzir Redis/BullMQ por padrao. Uma fila serial e aceitavel enquanto atender
a carga; o requisito imediato e durabilidade/lease recuperavel, nao uma nova pilha.

### BACK-007 - Retencao de PDFs temporarios no resumo

**Evidencia**

- O resumo remove diretorios apenas em `cleanOldJobs`, chamado por novas requisicoes,
  depois de duas horas e fora dos estados `queued`/`processing`.
- `runJobPipeline` e `continueJobPipeline` nao possuem `finally` de limpeza nem rota
  de cancelamento/exclusao.
- O simulado, em contraste, remove `job.dir` no `finally`.

**Risco**

PDFs medicos ficam no disco efemero alem do necessario e podem nunca ser removidos
em uma instancia ociosa. Jobs travados tambem nao expiram.

**Pronto quando**

- originais e imagens forem apagados assim que a ultima etapa que os usa terminar;
- restart/erro/cancelamento tiverem reconciliacao de temporarios orfaos;
- a politica de retencao estiver documentada e testada.

### BACK-008 - Contratos de IA estritos fora do fluxo ativo

**Status: em andamento; corrigido no corte opt-in de um PDF.**

**Evidencia**

- O fluxo legado usa `any`, `parseJsonSafely` e strings Markdown livres em
  [`summaryJobs.ts`](../server/summaryJobs.ts#L104).
- No corte opt-in de um PDF, `SummaryProvider.generateSection` e
  `repairSection` passam por `executeAiCallWithValidation`; claims sem fonte,
  truncamento e cobertura ausente falham fechado.
- SPEC, visao e todos os jobs multi-PDF ainda usam os contratos legados.

**Risco**

Saidas sintaticamente recuperaveis, mas semanticamente incompletas, podem avancar.
Isso contradiz a regra de falha fechada para conteudo truncado, evidencia ausente e
auditoria invalida.

**Pronto quando**

- cada etapa de IA ativa validar um schema versionado antes de persistir/avancar;
- falha de schema tiver retry limitado, telemetria e estado terminal claro;
- prompts, schemas e modelos ativos forem os mesmos descritos na arquitetura.

### BACK-009 - Cobertura por presenca de citacao, nao por evidencia

**Evidencia**

- [`getOmittedPages`](../server/summaryJobs.ts#L506) considera coberta toda pagina
  substancial cujo numero apareca em qualquer citacao.
- [`repairSummaryOmissions`](../server/summaryJobs.ts#L527) concatena um
  `Complemento de Cobertura de Paginas`, embora a arquitetura alvo exija reparo na
  secao tematica correta.

**Risco**

Uma citacao decorativa pode mascarar omissao factual. O apendice reduz coerencia e
nao garante que afirmacoes criticas tenham trecho literal de suporte.

**Pronto quando**

- claims criticos forem ligados a pagina/bloco/trecho verificavel;
- reparo atualizar a secao afetada e passar novamente pela validacao;
- conjunto ouro medico medir cobertura, numeros/comparadores e aprovacao humana.

### BACK-010 - Administracao dependente de allowlist opcional

**Evidencia**

- [`index.ts`](../server/index.ts#L6) apenas avisa quando `ALLOWED_EMAILS` esta vazio.
- [`adminMetrics.ts`](../server/src/routes/adminMetrics.ts#L9) autoriza qualquer
  autenticado em producao quando a lista esta vazia, inclusive para reset.
- O `server/AGENTS.md` dizia que producao falharia ao iniciar nessa condicao.

**Risco**

Um erro de configuracao amplia silenciosamente privilegios administrativos.

**Pronto quando**

- producao falhar cedo sem configuracao administrativa valida, ou usar um papel de
  admin explicito e independente da allowlist de acesso ao produto;
- testes cobrirem producao com lista vazia e usuario comum.

### BACK-011 - Estado operacional local ao processo

**Evidencia**

- jobs, filas, rate limits, concorrencia e telemetria ficam em memoria.
- `rateLimitBuckets` nao possui varredura global; chaves de clientes que nao voltam
  permanecem no `Map`.
- duas instancias aplicam limites e filas independentes.

**Risco**

Escala horizontal permite exceder cotas, duplica trabalho e perde observabilidade.
Muitos identificadores unicos podem aumentar memoria do rate limiter.

**Pronto quando**

- a topologia suportada (uma ou varias instancias) estiver declarada;
- estado que precisa consistencia usar storage compartilhado ou o deploy for
  explicitamente single-instance;
- buckets expirados tiverem limpeza e metricas de cardinalidade.

### BACK-012 - Configuracao e health check superficiais

**Evidencia**

- `env.ts` converte numeros e strings sem schema nem validacao de faixa.
- `getSupabaseAdminClient` aceitava publishable key como fallback de uma funcao
  chamada "Admin", o que mascarava ausencia de service role. O fallback foi removido no
  primeiro corte do BACK-006; validacao de startup/readiness continua pendente.
- [`/api/health`](../server/src/routes/health.ts#L8) sempre responde `{ ok: true }`.

**Risco**

O deploy pode ser marcado saudavel sem auth, worker, banco ou providers necessarios.
Configuracao invalida falha tarde, durante um job caro.

**Pronto quando**

- startup validar configuracao obrigatoria por ambiente e limites numericos;
- `health` continuar barato para liveness e existir readiness que verifique
  dependencias essenciais sem expor segredos;
- clientes admin e user tiverem nomes e requisitos inequivocos.

### BACK-013 - Mensagens internas expostas

**Evidencia**

- `jsonErrorHandler`, jobs, proxy de IA e exportacao Notion devolvem
  `error.message`, inclusive mensagens recebidas de upstream.

**Risco**

Detalhes de infraestrutura, modelos e respostas de terceiros podem escapar para o
cliente. Ao mesmo tempo, nao existe um identificador de erro consistente para
correlacionar logs.

**Pronto quando**

- respostas publicas usarem codigos/mensagens estaveis e sanitizados;
- detalhes ficarem em log estruturado com correlation/job ID, sem PDF, prompt ou
  token.

### BACK-014 - TypeScript nao protege fronteiras criticas

**Evidencia**

- [`tsconfig.json`](../tsconfig.json) define `strict: false`.
- A auditoria encontrou 80 ocorrencias de `any` no backend fora dos testes,
  concentradas em jobs, proxy de IA, Notion e payloads externos.

**Risco**

Mudancas de contrato entre Express, Python, providers e banco compilam sem garantir
forma, justamente nas fronteiras mais sensiveis.

**Pronto quando**

- schemas de runtime gerarem/informarem tipos nas fronteiras;
- `strict` for habilitado incrementalmente no backend, sem reescrita total;
- `any` restante estiver limitado a adaptadores validados.

### BACK-015 - Testes verdes com lacunas de integracao

**Linha de base executada**

- `npm test`: 8 arquivos, 49 testes, todos passaram;
- `npm run typecheck`: passou;
- `python -m unittest discover -s worker -p "test_*.py"`: 25 testes, todos passaram.

**Lacunas observadas**

- o contrato legado real, dois PDFs e os quatro modos de visao agora possuem
  regressao; ainda nao ha teste HTTP do job completo com providers simulados;
- o caminho resumo -> simulado possui validação unitária do corpus, mas ainda não
  possui smoke HTTP autenticado com provedores reais;
- limpeza/cancelamento do resumo ainda nao e coberto;
- repositories sao testados com client mock, nao contra RLS/Postgres;
- nao ha teste de instalacao a partir de `requirements.txt` nem smoke do container.

**Pronto quando**

- os caminhos P0 tiverem testes de regressao menores que o pipeline completo;
- RLS tiver matriz usuario A/usuario B/service role;
- o smoke de deploy executar health, auth e um worker minimo.

### BACK-016 - Superficie Vercel incompleta

**Evidencia**

- `api/` contem adaptadores para health, auth, config, Notion e proxies, mas nao para
  `/api/summary/jobs/*` ou `/api/quiz/jobs/*`.
- jobs e filas em memoria continuam executando depois da resposta HTTP, modelo
  incompativel com funcoes efemeras sem coordenacao externa.

**Risco**

Um deploy guiado por `vercel.json` entrega frontend/proxies, mas nao o produto
principal, ou perde jobs ao encerrar a funcao.

**Pronto quando**

- houver uma decisao explicita: Vercel e apenas frontend e aponta para o backend
  Docker, ou a superficie serverless ganhar arquitetura duravel;
- adaptadores legados que sugerem suporte inexistente forem removidos/documentados.

### BACK-017 - Uploads materializados no heap

**Evidencia**

- ambos os jobs usam `express.raw(... limit: '50mb')` e depois criam/escrevem um
  `Buffer` completo.
- o limite global permite uploads simultaneos e nao ha `concurrencyLimit` nessa fase.

**Risco**

Uploads paralelos podem elevar o RSS e causar OOM antes dos limites por job entrarem
em efeito.

**Pronto quando**

- houver medicao de memoria com o limite real;
- se necessario, upload for transmitido diretamente a arquivo/storage com magic
  bytes, tamanho e aborto preservados. Nao adicionar biblioteca se streams nativos
  cobrirem o caso.

### BACK-018 - Duplicacao e fronteiras de modulo

**Evidencia**

- `summaryJobs.ts` e `quizJobs.ts` repetem lifecycle, upload, worker, fila, ownership
  e cliente de IA, mas com diferencas de limpeza/cancelamento.
- o servidor importa `src/features/quiz/services/quizApi.ts`, que por sua vez importa
  servicos de auth e orquestracao do frontend e usa um setter global para injetar o
  caller server-side.

**Risco**

Correcoes chegam a um fluxo e nao ao outro; dependencias de browser podem entrar no
runtime do servidor sem intencao.

**Pronto quando**

- logica realmente isomorfica morar em modulo neutro e tipado;
- lifecycle comum so for extraido depois que os contratos P0 estiverem estabilizados;
- implementacoes antigas forem removidas ao integrar a camada V2.

### BACK-019 - Deriva documental

**Evidencia**

- indices apontavam `server/index.js`, `app.js` e `summaryJobs.js`, mas os arquivos
  atuais sao `.ts`; os indices principais ja foram corrigidos nesta auditoria;
- o comando obsoleto `--self-test` foi removido dos indices principais;
- `docs/deployment-portability.md` afirma que estado e PDFs persistentes ficam no
  Supabase, embora o pipeline ativo use RAM e disco temporario;
- documentos de julho misturavam estado alvo com estado entregue; foram marcados
  como históricos e seus links agora são relativos ao repositório.

**Risco**

LLMs e pessoas alteram o modulo errado, assumem garantias inexistentes ou executam
checagens invalidas.

**Pronto quando**

- todo documento declarar `atual`, `alvo` ou `historico`;
- links forem relativos ao repositorio;
- `AGENTS.md` e comandos forem validados junto da mudanca que altera o contrato.

### BACK-020 - Grants excessivos no Supabase remoto

**Status: corrigido e validado no Supabase remoto em 09/08/2026.**

**Evidencia**

- Consulta a `information_schema.role_table_grants` em 09/08/2026 mostrou `ALL`
  para `anon` e `authenticated` nas seis tabelas legadas, inclusive `TRUNCATE`,
  `TRIGGER` e `REFERENCES`.
- As oito policies existentes se aplicavam ao role `public`; `summaries` possuia
  duas policies `ALL` equivalentes.
- RLS nao protege `TRUNCATE`.

**Correcao local**

- [`202607230001_backend_security_hardening.sql`](../supabase/migrations/202607230001_backend_security_hardening.sql)
  revoga os grants amplos, concede apenas o contrato usado e limita policies a
  `authenticated`.
- A migration V2 agora tambem revoga grants padrao antes de conceder acesso.
- O dry-run remoto retornou `dry_run_ok`. A checagem posterior confirmou o
  rollback: zero constraints novas, 42 grants de `anon` e duas policies de
  `summaries` continuaram presentes.
- Depois da aplicacao persistente, `backend_security.sql` passou e o historico
  remoto registrou `202607230001` como aplicado.

### BACK-021 - Integridade multi-tenant no schema legado

**Status: corrigido e validado no Supabase remoto em 09/08/2026.**

**Evidencia**

- FKs de flashcards, simulados e tentativas validavam apenas o ID do pai, embora
  as tabelas filhas tambem guardem `user_id`.
- A policy de `quizzes` nao correlacionava `summary_id`; a de `quiz_attempts` nao
  correlacionava `quiz_id`.
- A auditoria remota encontrou zero referencias cruzadas nas quatro relacoes em
  09/08/2026, portanto as constraints podem ser adicionadas sem saneamento.

**Correcao local**

- A migration de hardening adiciona chaves unicas e FKs compostas `(id, user_id)`.
- [`backend_security.sql`](../supabase/tests/backend_security.sql) verifica grants,
  roles das policies, constraints e referencias cruzadas.

### BACK-022 - Protecao contra senhas vazadas desabilitada

**Evidencia**

- O Security Advisor remoto apresentou um warning: `Leaked Password Protection
  Disabled`.

**Pronto quando**

- a protecao for habilitada nas configuracoes de Authentication;
- o Security Advisor for reexecutado sem o warning.

## Ordem recomendada

1. **Concluido no working tree:** corrigir BACK-001, BACK-002 e BACK-003 e deixar
   testes de regressao.
2. **Concluido no remoto:** aplicar/validar o hardening legado (BACK-020 e
   BACK-021) e reconciliar o historico de migrations. BACK-022 depende do plano.
3. Validar BACK-004 e BACK-005 com dois usuarios no banco e somente entao aplicar
   a migration V2 corrigida.
4. **Em andamento:** upload -> job -> Document IR -> provider validado -> resultado
   existe para um PDF. Continuar com persistencia idempotente de blocos/fontes e
   recuperacao;
   depois remover o caminho substituido.
5. Fechar retencao, autorizacao e qualidade: BACK-007 a BACK-010.
6. Tratar operacao, tipos, deploy e organizacao com evidencia de carga/uso.

## Decisoes que nao sao divida por si so

- Fila serial: aceitavel enquanto throughput real nao exigir paralelismo; a falta de
  durabilidade e que e divida.
- `fetch` direto: aceitavel; SDK/factory so se justifica quando reduzir duplicacao
  ativa ou permitir troca real de provider.
- Parser Markdown simples do Notion: aceitavel enquanto o subconjunto suportado
  estiver declarado e coberto por fixtures.
- Nao adotar Redis, BullMQ, ORM ou nova biblioteca apenas para "preparar escala".
