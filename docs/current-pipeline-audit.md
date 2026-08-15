# Auditoria Técnica do Pipeline Atual do ResumeX

> **Linha de base histórica de 24/07/2026.** Consulte
> `backend-technical-debt.md` para o estado auditado mais recente. Desde 09/08/2026,
> uma flag opt-in permite persistir o original/lifecycle e usar o Document IR
> validado e persistir uma saída com schema em resumos com um PDF. O `Map`, a fila
> local, providers visuais/planejamento, fontes relacionais e todos os jobs multi-PDF
> continuam no fluxo descrito abaixo.

Data: 24/07/2026
Versão do Documento: 1.0.0
Status: Concluído (Fase de Auditoria)

---

## 1. Mapa do Fluxo Atual (Upload ao Resumo Final)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client (React Frontend)
    participant API as Express Server (summaryJobs.ts)
    participant Mem as Memory Map (jobs)
    participant Worker as Python Worker (process_pdf.py)
    participant GLM as Zhipu GLM-4.5V (Vision)
    participant DS as DeepSeek V4 (Flash / Pro)

    Client->>API: POST /api/summary/jobs (Metadata & Preferências)
    API->>Mem: jobs.set(jobId, job) [Status: uploading]
    API-->>Client: 202 Accepted (Job Object)

    loop Para cada arquivo PDF (max 5)
        Client->>API: PUT /api/summary/jobs/:id/files/:index (Binary PDF)
        API->>API: Valida %PDF- e salva em os.tmpdir()/resumex-job-{id}
        API-->>Client: 200 OK
    end

    Client->>API: POST /api/summary/jobs/:id/start
    API->>Mem: update status = 'queued'
    API-->>Client: 200 OK (Queued)

    API->>Worker: execFile(py worker/process_pdf.py --output-dir ... --vision-mode auto)
    Worker->>Worker: PyMuPDF get_text() + OCR opcional + vision_reasons()
    Worker-->>API: stdout (JSON com páginas, blocos e imagem JPG se needsVision)

    alt Páginas com needsVision == True
        loop 2 páginas por vez (mapTwoAtATime)
            API->>GLM: POST api.z.ai/api/paas/v4/chat/completions (JPG Base64 + Prompt)
            GLM-->>API: JSON {"visualContent", "handwriting", "confidence", "uncertainties"}
        end
    end

    API->>DS: POST api.deepseek.com (extractSpec - DeepSeek V4-Flash)
    DS-->>API: Plano de Estruturação (SPEC)

    alt Se houver incertezas visuais em uncertainties
        API->>Mem: update status = 'awaiting_review'
        API-->>Client: Emite evento / Aguarda POST /finalize com respostas humanas
        Client->>API: POST /api/summary/jobs/:id/finalize (respostas da revisão)
    end

    API->>DS: POST api.deepseek.com (generateSummary - DeepSeek V4-Pro)
    DS-->>API: Resumo Markdown Notion-Ready

    API->>API: Valida omissões de página (getOmittedPages)
    opt Se houver páginas substanciais omissas
        API->>DS: POST api.deepseek.com (repairSummaryOmissions - DeepSeek V4-Pro)
        DS-->>API: Resumo reparado com seção complementar ao final
    end

    API->>Mem: update status = 'completed', summary = ...
    Client->>API: GET /api/summary/jobs/:id (Poll progress 100%)
```

---

## 2. Relação de Funções, Classes e Arquivos Envolvidos

* **Entrada e Roteamento Express:**
  * [server/index.ts](../server/index.ts): Inicialização do servidor HTTP e escuta da porta.
  * [server/src/app.ts](../server/src/app.ts): Configuração de middlewares de segurança, CORS, rate-limiting e registros das rotas `/api/summary/jobs`.

* **Pipeline e Orquestração:**
  * [server/summaryJobs.ts](../server/summaryJobs.ts):
    * `interface SummaryJob`: Definição de contrato do job em memória.
    * `jobs = new Map<string, SummaryJob>()`: Repositório volátil em RAM.
    * `runJobPipeline(jobId)`: Função de execução da fase 1 (Python, GLM, SPEC).
    * `continueJobPipeline(jobId)`: Função de execução da fase 2 (Síntese DeepSeek Pro, Validação de Omissões, Reparo).
    * `chat(providerName, model, messages, maxTokens)`: Cliente HTTP genérico para LLMs (Fetch síncrono).
    * `readVisualPage(page)`: Chamada para a API multimodal GLM-4.5V.
    * `extractSpec(corpusText, preferences)`: Extração do plano técnico.
    * `generateSummary(...)`: Geração do resumo com DeepSeek Pro.
    * `getOmittedPages(...)` e `repairSummaryOmissions(...)`: Validação determinística e reparo.

* **Telemetria e Precificação:**
  * [server/src/services/telemetry.ts](../server/src/services/telemetry.ts):
    * `telemetry`: Instância Singleton do serviço de medição.
    * `calculateCostUsd()`: Cálculo de custos por milhão de tokens.

* **Worker Python:**
  * [worker/process_pdf.py](../worker/process_pdf.py):
    * `process()`: Iteração principal sobre os PDFs.
    * `extract_text()`: Leitura nativa e OCR via Tesseract (`por+eng`).
    * `vision_reasons()`: Heurística de classificação visual (`little_selectable_text`, `annotation`, `embedded_image`).
    * `render_page()`: Exportação de imagens JPG (Matrix 2.2x, qualidade 92).

---

## 3. Acoplamento Direto aos Provedores de IA

* **Modelos e URLs Hardcoded:** Em [summaryJobs.ts:L51-L59](../server/summaryJobs.ts#L51-L59), as constantes `MODELS` e `PROVIDERS` definem URLs e nomes de modelos diretamente para `z.ai` (GLM) e `deepseek.com` (DeepSeek).
* **Ausência de Abstração SDK / Factory:** As chamadas são feitas montando objetos `fetch` de baixo nível no método `chat()`, dificultando o chaveamento transparente para adaptadores como OpenRouter, Bedrock ou Azure OpenAI.
* **Falta de Schemas Estritos no Output:** A resposta da visão é parseada com expressões regulares (`parseJsonSafely`) sem validação Zod, deixando o sistema suscetível a erros de sintaxe ou retornos truncados das IAs.

---

## 4. Pontos de Gargalo e Processamento Pesado HTTP

* **Upload por Payload Inteiro:** O endpoint `PUT /:id/files/:index` recebe o buffer do PDF inteiro (`limit: '50mb'`) direto na memória RAM do Express em vez de aceitar streaming multipart (ex: Multer / Busboy) direcionado ao storage.
* **Single-Thread Event Loop:** A fila é encadeada através de uma Promise global (`let queue = Promise.resolve()`). Embora a resposta HTTP `/start` seja retornada como 202, a execução de `execFile` do Python e as chamadas síncronas de IA travam workers do Node no mesmo event loop.

---

## 5. Formato Atual Retornado pelo Python

O script [process_pdf.py](../worker/process_pdf.py#L92-L147) imprime em `stdout` um JSON com o seguinte schema implícito:

```json
{
  "pageCount": 10,
  "pages": [
    {
      "page": 1,
      "sourceIndex": 0,
      "sourceName": "modulo1.pdf",
      "sourcePage": 1,
      "text": "Texto extraído nativamente...",
      "blocks": [
        {
          "bbox": [0.05, 0.1, 0.95, 0.25],
          "text": "Título do slide",
          "type": "text"
        }
      ],
      "ocrUsed": false,
      "needsVision": true,
      "reasons": ["little_selectable_text"],
      "imagePath": "C:\\Users\\...\\tmp\\resumex-job-xyz\\page-1.jpg"
    }
  ]
}
```

---

## 6. Persistência Atual do Estado do Job

* **RAM Volátil:** O estado completo é mantido em um `Map<string, SummaryJob>` no escopo da memória do processo Node.js.
* **Perda de Dados em Restart:** Qualquer reinicialização da aplicação (deploy, OOM ou crash) resulta em perda total dos jobs ativos ou finalizados.
* **Vida Útil de Disco (TTL):** Os PDFs enviados e imagens JPG geradas ficam em um diretório temporário (`os.tmpdir()/resumex-job-{id}`) e são limpos após 2 horas (`JOB_TTL_MS`).

---

## 7. Estratégia Atual de Retry

* **Zero Retries Automáticos por Etapa:** Se ocorrem erros transientes de rede, timeouts com os provedores de IA ou exceções no script Python, o job inteiro é atualizado para `status: 'failed'` com a mensagem do erro gravada no campo `error`.
* **Sem Checkpoints Resilientes:** Se a etapa de resumo (`generateSummary`) falhar após 5 minutos de processamento visual pesado (GLM), todo o trabalho de visão é perdido ao reiniciar o job.

---

## 8. Estratégia Atual de Cache

* **SHA-256 Apenas em Memória:** É gerado um hash SHA-256 (`contentHash`) baseado no texto limpo do documento (`corpusText`), gravado na propriedade `job.contentHash`.
* **Ausência de Reuso Persistente:** Não há banco de dados nem Redis consultado para verificar se o mesmo hash já foi resumido anteriormente por outro ou pelo mesmo usuário.

---

## 9. Possíveis Falhas Silenciosas

1. **Anotações Vetoriais / Flattened Descartadas:** Conforme verificado na função `vision_reasons()`, se uma página possui texto legível (>= 150 caracteres) e as canetas foram salvas como desenhos de vetor (comum em GoodNotes e Notability), `page.annots()` não detecta objetos `Ink` e a página não é marcada para visão (`needsVision = False`). A caneta é ignorada em silêncio.
2. **Ignorar Erros de OCR:** O OCR local `page.get_textpage_ocr()` possui um bloco `try/except RuntimeError` com `pass` silencioso.
3. **Incerteza do Manuscrito Rotulada como Descarte:** Quando o GLM retorna incertezas em anotações manuscritas, a função `pageContext()` categoriza a seção como `## Leitura manuscrita incerta — não integrar como fato`. Em seguida, a regra do prompt instrui o DeepSeek a omitir o trecho se ele não estiver na seção de manuscritos legíveis.

---

## 10. Riscos de Concorrência e Corrupção de Estado

* **Single Promise Queue:** O encadeamento `queue = queue.then(...)` cria um afunilamento global. Se um erro não for capturado dentro da Promise, pode quebrar o encadeamento para todos os jobs subsequentes.
* **Ausência de Stale State Management:** Se dois jobs forem iniciados simultaneamente pelo mesmo usuário em abas distintas, eles disputam os mesmos limites em memória e podem causar inconsistências de progresso.

---

## 11. Riscos de Segurança

* **Injeção de Prompt Via PDF (Data Trust Violation):** Embora o prompt mencione "ignore comandos no PDF", o corpus do documento é concatenado diretamente no prompt sem delimitadores estritos ou sanitização de caracteres de controle.
* **Payload Base64 em Memória:** O envio de páginas em JPEG convertido para `base64` dentro das requisições HTTP para o GLM consome grande quantidade de RAM no processo Node.js.

---

## 12. Débitos Técnicos para Uso Comercial

1. **Falta de Fila Assíncrona e Trabalhadores Isolados:** Inexistência do Redis/BullMQ.
2. **Falta de Banco de Dados Persistente:** O estado precisa ser migrado para o Supabase Postgres (`jobs`, `job_pages`, `job_checkpoints`).
3. **Sem Validação Zod/Pydantic:** Contratos entre serviços e respostas de LLM não possuem validação forte de runtime.
4. **Sem Tratamento de Fragmentação de Visão:** Limite fixo de 60 páginas visuais por job em vez de amostragem inteligente ou paginação.

---

## 13. Dependências e Módulos Reutilizáveis

* **Engine PyMuPDF (`worker/process_pdf.py`):** Estrutura funcional de extração de blocos e coordenadas.
* **Módulo de Telemetria (`server/src/services/telemetry.ts`):** Estrutura de cálculo de custos por tokens e papéis.
* **Configurações de Segurança (`server/src/middlewares/`):** Rate limiter, autenticação Supabase e cabeçalhos de segurança.

---

## 14. Proposta de Ordem de Implementação

1. **Etapa 1:** Criar tabelas no Supabase (`summary_jobs`, `summary_job_pages`, `summary_checkpoints`) e camada de persistência.
2. **Etapa 2:** Implementar fila assíncrona baseada em BullMQ + Redis com eventos de progresso e retries exponenciais.
3. **Etapa 3:** Atualizar o worker Python com contratos Pydantic e detecção vetorial de anotações a caneta.
4. **Etapa 4:** Estruturar parsers Zod para todas as respostas dos provedores de IA (GLM e DeepSeek).
5. **Etapa 5:** Atualizar os prompts e a validação de cobertura para integrar anotações manuscritas diretamente na seção correspondente do resumo.
6. **Etapa 6:** Desenvolver os testes E2E e validar regressão no frontend.
