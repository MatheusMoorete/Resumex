# Notas de Implementação e Arquitetura do ResumeX

> **Documento histórico de proposta (24/07/2026).** BullMQ, Redis, checkpoints,
> Document IR e providers V2 descritos abaixo não estão entregues no runtime ativo.
> A fonte atual é `backend-technical-debt.md`. Em 09/08/2026 entrou apenas uma ponte
> opt-in que persiste original/lifecycle e valida o Document IR de resumos com um
> PDF; ela fica desligada por padrão. O provider final validado e
> `summary_versions` já participam desse corte, mas planning/vision V2,
> páginas/blocos/fontes, restart e multi-PDF não.

Data: 24/07/2026
Versão: 1.0.0 (Fase de Auditoria Técnica)

---

## 1. Decisões Arquiteturais

1. **Separação Estrita de Responsabilidades:**
   - **Frontend:** Interface React 19 focada na experiência do usuário (upload, progresso e visualização Notion-Ready).
   - **Express API:** Gateway fino para validação de entrada, autenticação JWT via Supabase e gestão de sessões.
   - **Fila Assíncrona (BullMQ + Redis):** Isolamento total das tarefas de processamento pesado do event loop do Node.js.
   - **Worker Python (PyMuPDF):** Processamento local determinístico de PDFs, OCR por região e detecção vetorial de anotações.
   - **Orquestrador de IA (Node.js):** Gerenciador de estado do job, validação de contratos Zod e chamadas adaptativas às APIs de LLM.

2. **Garantia de Grounding Médico Estrito:**
   - Mantida a premissa de que o PDF é a única fonte factual. Nenhuma informação externa deve ser alucinada pelos modelos.
   - As anotações manuscritas capturadas e confirmadas devem ser mantidas e destacadas em vermelho: `<span style="color: #d9381e; font-weight: 600;">(✍️ Manuscrito: [conteúdo da nota])</span>`.

3. **Checkpoints e Idempotência:**
   - O estado de cada página (texto extraído, blocos com coordenadas, leitura de visão) deve ser persistido em banco de dados (`summary_job_pages`) assim que concluído.
   - Falhas na fase de síntese reutilizam as etapas visuais e de OCR já concluídas, zerando o custo repetido de chamadas ao GLM-4.5V.

---

## 2. Ambiguidades Encontradas

1. **Classificação de Anotações em Vetor vs. Imagem Rasteirizada:**
   - PDFs exportados por aplicativos como Samsung Notes ou Apple Markup às vezes mesclam marca-texto e caneta em um único objeto de conteúdo da página.
   - *Resolução Proposta:* O worker Python utilizará uma combinação de `page.annots()`, `page.get_drawings()` e razão de área de imagem para definir `needsVision = True` sempre que houver traços não reconhecidos como fontes de texto.

2. **Definição de Limite Seguro para Leitura Visual:**
   - O código atual possui um limite rígido de 60 páginas visuais (`MAX_VISION_PAGES = 60`). Em documentos de 200 páginas escaneadas, isso pode exceder a cota.
   - *Resolução Proposta:* Permitir amostragem dinâmica ou permitir que o usuário selecione no frontend quais capítulos/páginas deseja submeter à leitura visual profunda.

---

## 3. Desvios da Especificação Atual

1. **Formato do Complemento de Omissões:**
   - Atualmente, a função `repairSummaryOmissions` concatena um bloco `## Complemento de Cobertura de Páginas` ao final do resumo gerado.
   - *Ajuste Solicitado:* A especificação comercial exige que informações de páginas omitidas sejam mescladas na seção temática correta do resumo principal.

2. **Armazenamento de Estado do Job:**
   - A implementação atual armazena jobs em um `Map` em memória RAM, contrariando a especificação comercial de suporte a múltiplos usuários e persistência em banco.

---

## 4. Alternativas Consideradas

1. **Utilizar Unicamente Visão (Sem Extração de Texto Nativo):**
   - *Descartado:* Converter todas as páginas em imagem e enviar para o GLM aumentaria o custo financeiro em mais de 10x e aumentaria a latência em documentos longos (100+ páginas).
   - *Escolhida:* Abordagem Híbrida — Texto nativo extraído localmente sem custo + Visão acionada apenas para páginas com elementos visuais ou manuscritos.

2. **RAG (Retrieval-Augmented Generation) com Embeddings Vectoriais:**
   - *Descartado:* A fragmentação de parágrafos em RAG causa perda de contexto de tabelas complexas e fluxogramas médicos.
   - *Escolhida:* Janela de Contexto Expandida do DeepSeek V4 (1,5M tokens) processando o corpus estruturado de uma só vez.

---

## 5. Riscos Técnicos Identificados

1. **Estouro de Memória no Node.js (OOM):**
   - Envio de múltiplas imagens em `base64` dentro das requisições HTTP para o GLM pode estourar o limite de memória do processo Node.
   - *Mitigação:* Usar streaming e upload de imagens temporárias para o Supabase Storage, enviando apenas URLs públicas/assinadas para a API de visão.

2. **Rate Limits das APIs dos Provedores:**
   - Rajadas simultâneas de jobs por múltiplos usuários podem atingir o limite por minuto (RPM/TPM) da Zhipu (GLM) ou DeepSeek.
   - *Mitigação:* Fila do BullMQ com controle de taxa de disparo por provedor (`limiter`).

---

## 6. Limitações Ainda Existentes

1. **Falta de Tesseract OCR em Ambientes Serverless/Docker Mínimos:**
   - O worker depende do binário do Tesseract instalado no sistema operacional para OCR local.
   - *Estratégia:* Garantir a presença da biblioteca no `Dockerfile` oficial do projeto ou chavear automaticamente para o GLM em caso de ausência do Tesseract.

---

## 7. Migrações Necessárias

1. **Criação das Tabelas no Supabase Postgres:**
   - Script SQL para criação de `summary_jobs`, `summary_job_pages` e `summary_checkpoints`.
2. **Adição do Redis na Infraestrutura:**
   - Provisionamento de instância Redis (Upstash / Redis Cloud / Container Docker) para suporte ao BullMQ.
3. **Instalação dos Pacotes Zod e BullMQ:**
   - `npm install bullmq zod ioredis`.

---

## 8. Questões que Exigem Confirmação Humana

1. **Estratégia para PDFs com Mais de 100 Páginas Escaneadas:**
   - Qual a tolerância máxima de custo/latência por job para o usuário final em produção?
2. **Comportamento em Manuscritos Parcialmente Legíveis:**
   - O sistema deve sugerir uma transcrição provável e pausar para aprovação ou ignorar automaticamente se a confiança for menor que X%?

---

## 9. Implementação da Representação Intermediária (Document IR)

Data: 24/07/2026

### Resumo da Implementação:
1. **Contratos em Python ([worker/document_ir.py](../worker/document_ir.py)):**
   - Criados modelos Pydantic v2 para `DocumentIR`, `DocumentPage`, `ContentBlock`, `BBox`, `BlockRelationship`, `ProcessingPlan`, `RasterReference`, `VisualRegion`.
   - Enums tipados para `BlockType` (20 tipos), `SemanticRole` (12 papéis), `ContentSource` (8 fontes), `RelationshipType` (10 relacionamentos).
   - Validações Pydantic ativas: `schemaVersion` (v1.x.x), `confidence` em `[0.0, 1.0]`, coordenadas `BBox` (`x0 <= x1` e `y0 <= y1`), rotação (0, 90, 180, 270) e checagem de integridade referencial de `targetBlockId`.
   - Gerador de IDs de bloco estáveis: `generate_block_id(pageNumber, blockType, sequence, contentSample)` -> `p{pageNumber}-{type}-{sequence}-{shortHash}`.

2. **Schemas Zod em Node.js ([server/src/schemas/documentIr.ts](../server/src/schemas/documentIr.ts)):**
   - Schemas Zod equivalentes para runtime no Node.js.
   - Suporte a `.nullish()` com transformações para garantir compatibilidade com `null` do Python em campos opcionais (`polygon`, `language`, `metadata`, `visualAttributes`).
   - Validação de integridade referencial de relacionamentos em tempo de parsing Zod.

3. **Suíte de Testes Automatizados:**
   - **Python ([worker/test_document_ir.py](../worker/test_document_ir.py)):** 7 testes cobrindo serialização JSON, BBox inválido, confiança fora de limite, ID de relacionamento inexistente, versão de schema incompatível, documentos sem páginas e páginas sem blocos.
   - **Node.js / Vitest ([server/tests/documentIr.test.ts](../server/tests/documentIr.test.ts)):** 8 testes incluindo **JSON Round-Trip real** executando o script Python via `execFileSync` e validando a saída diretamente no Zod no Node.js.

---

## 10. Refatoração do Worker Python (Document IR Inicial)

Data: 24/07/2026

### Resumo da Implementação:
1. **Interface CLI Estruturada ([worker/process_pdf.py](../worker/process_pdf.py)):**
   - Suporte à CLI exigida: `--input`, `--output`, `--artifacts-dir`, `--document-id`, `--schema-version`, `--max-pages`, `--max-file-size`.
   - Compatibilidade mantida com invocações legadas (`process()`) para retrocompatibilidade.
   - `stdout` emite apenas eventos leves e estruturados em formato JSON (ex: `{"event": "page_processed", ...}`).

2. **Extração Determinística com PyMuPDF:**
   - Extração de texto nativo com bboxes, fontes, tamanhos e identificação de títulos (`heading`).
   - Cobertura aproximada de texto nativo e imagens raster por página (`nativeTextCoverage`, `rasterImageCoverage`).
   - Detecção e extração de tabelas nativas via `page.find_tables()`, gerando blocos `table`, `table_cell` e relacionamentos `belongs_to_table`.
   - Mapeamento de anotações PDF (`highlight`, `underline`, `strikeout`, `ink`, `freetext`, `arrow`).
   - Identificação de desenhos vetoriais (`get_drawings()`) e classificação preliminar de páginas (`likelyScanned`, `likelyComplexLayout`, `hasPdfAnnotations`, `hasVectorDrawings`).

3. **Geração de Artefatos & Segurança:**
   - Renderização de preview leve da página a 120–150 DPI em `artifacts-dir/pages/page-XXXX-preview.jpg`.
   - Armazenamento de imagens incorporadas em `artifacts-dir/embedded-images/` e geração de `manifest.json`.
   - Validação de segurança: verificação do cabeçalho `%PDF-`, rejeição de PDFs protegidos por senha (`document.needs_pass`), limite de tamanho (100MB) e de páginas (300).

4. **Suíte de Testes Automatizados:**
   - **Python ([worker/test_process_pdf.py](../worker/test_process_pdf.py)):** 9 testes cobrindo texto nativo, PDF escaneado, anotações/highlights, tabelas, imagens incorporadas, página vazia, página rotacionada, PDF inválido e protegido por senha.
   - **Node.js ([server/tests/processPdfValidation.test.ts](../server/tests/processPdfValidation.test.ts)):** Teste E2E de invocação via CLI e validação rigorosa da saída JSON contra o `DocumentIRSchema` do Zod.

---

## 11. Módulo de Análise e Classificação Visual de Páginas (`page_analysis.py`)

Data: 24/07/2026

### Resumo da Implementação:
1. **Módulo Dedicado ([worker/page_analysis.py](../worker/page_analysis.py)):**
   - Implementado analisador de páginas em 3 camadas:
     - **Camada 1 (Sinais do PDF):** PyMuPDF `text_dict`, `annots()` (highlight, ink, freetext), `get_drawings()`, `find_tables()`, `get_image_info()`.
     - **Camada 2 (Heurísticas Visuais & Análise de Cor):** Inspeção de traços vetoriais coloridos e análise de pixmap RGB para detecção de marcas de caneta azul/vermelha e destaques de marca-texto.
     - **Camada 3 (Classificador Visual Estruturado):** Fallback leve para decidir `requiresVisionUnderstanding` e `requiresFullPageVision` sem acionar chamadas caras de LLM.

2. **Gerenciamento de Regiões Candidatas (`CandidateRegion`):**
   - Algoritmo de fusão (`merge_candidate_regions`): Agrupa regiões de interesse que se sobrepõem ou possuem proximidade <= 15 pontos.
   - Enforce de limites min/max e clipping de coordenadas dentro das dimensões exatas da página.
   - Renderização de crops de alta resolução (300 DPI) para regiões que necessitam de leitura visual profunda (`requiresHighResolution = True`) em `artifacts-dir/crops/page-XXXX-region-YY.jpg`.
   - Cálculo de hash SHA-256 (`cropHash`) para cada imagem de recorte gerada.

3. **Relatório de Desenvolvimento:**
   - Emissão automática do relatório `artifacts/page-analysis-report.json` em ambientes de desenvolvimento/teste contendo o mapa de decisão de todas as páginas.

4. **Fixture & Suíte de Testes de Aceitação ([worker/test_page_analysis.py](../worker/test_page_analysis.py)):**
   - Criado gerador de PDF de teste reproduzindo a estrutura do PDF do SUS ([tests/fixtures/create_sus_fixture.py](../tests/fixtures/create_sus_fixture.py)).
   - **Validação de Aceitação (7/7 testes aprovados):**
     - Página 1: Classificada com texto nativo + tabela + manuscrito à caneta.
     - Página 3: Classificada com texto + destaques (highlight) + manuscrito + relações visuais.
     - Página 4: Classificada para análise visual integral (`useFullPageVision` / `requiresPrintedOcr`).
     - Páginas 6, 7 e 10: Preservam a estrutura tabular nativa.
     - 100% das páginas possuem um `processingPlan` explícito.
     - A presença de texto nativo **nunca** impede a detecção de manuscritos a caneta.

---

## 12. Desacoplamento dos Provedores de IA (`server/src/ai/`)

Data: 24/07/2026

### Resumo da Implementação:
1. **Interfaces Abstratas de IA ([server/src/ai/types.ts](../server/src/ai/types.ts)):**
   - Criadas as interfaces `OcrProvider`, `VisionProvider`, `PlanningProvider` e `SummaryProvider`.
   - Todas as chamadas aceitam o contrato unificado `AIProviderCallParams` (`jobId`, `documentId`, `operationId`, `input`, `modelOptions`, `timeoutMs`, `traceContext`).
   - Todas as respostas retornam `AIProviderResponse` (`provider`, `model`, `modelVersion`, `promptVersion`, `output`, `usage`, `latencyMs`, `warnings`, `rawResponseReference`).

2. **Prompts Versionados ([server/src/ai/prompts/](../server/src/ai/prompts/)):**
   - Isolados em arquivos dedicados por operação:
     - `handwriting-transcription/v1.ts`: Transcrição paleográfica/médica estrita sem alucinações médicas ou suposições externas.
     - `visual-relations/v1.ts`: Identificação de conexões visuais e setas entre anotações e blocos nativos.
     - `table-reconstruction/v1.ts`: Reconstrução tabular estruturada sem inventar células ausentes.
     - `summary-plan/v1.ts`: Estruturação do plano temático do resumo a partir do Document IR.
     - `section-summary/v1.ts`: Resumo de seção grounded nos blocos fornecidos sem frases preâmbulo ("o texto diz").
     - `final-synthesis/v1.ts`: Síntese final em Markdown Notion-ready preservando citações e afirmações factuais.
     - `repair-section/v1.ts`: Edição e reparo direto na seção afetada (sem gerar blocos isolados chamados "complemento").
     - `page-classifier/v1.ts`: Classificação rápida de layout visual em baixa resolução.

3. **Validação Estrita via Schemas Zod ([server/src/ai/schemas/](../server/src/ai/schemas/)):**
   - Schemas de runtime para cada operação: `HandwritingTranscriptionSchema`, `VisualRelationsSchema`, `TableReconstructionSchema`, `SummaryPlanSchema`, `SectionSummarySchema`, `FinalSynthesisSchema` e `RepairSectionSchema`.
   - Execução resiliente via `baseProvider.ts`: Tenta a validação de schema e permite **no máximo 1 retry de autocorreção de formato JSON** em caso de falha. Se persistir, lança uma exceção registrada com telemetria.

4. **Implementações Concretas dos Provedores ([server/src/ai/providers/](../server/src/ai/providers/)):**
   - `GlmVisionProvider`: Integração encapsulada com GLM-4.5V sem espalhar SDKs pelo código.
   - `DeepSeekPlanningProvider`: Integração com DeepSeek V4-Flash para planejamento estrutural.
   - `DeepSeekSummaryProvider`: Integração com DeepSeek V4-Pro para resumo e síntese final.
   - `TesseractOcrProvider` & `CompositeOcrProvider`: Provedores de OCR local e híbrido.
   - `MockProviders`: Suíte de mocks isolada usada exclusivamente em testes automatizados.

5. **Política de Roteamento de Modelos (`AIRouter` em [server/src/ai/router.ts](../server/src/ai/router.ts)):**
   - Roteia dinamicamente tarefas simples para modelos mais baratos (DeepSeek Flash / Tesseract OCR), manuscritos difíceis para modelos visuais superiores (GLM-4.5V) e torna o planejamento obrigatório para documentos longos (> 5 páginas) ou complexos.

6. **Suíte de Testes Automatizados ([server/tests/aiProviders.test.ts](../server/tests/aiProviders.test.ts)):**
   - 8 testes cobrindo validação de schemas Zod, execução dos provedores mock e políticas de roteamento do `AIRouter` (todos os 43 testes da suíte Vitest passando).
