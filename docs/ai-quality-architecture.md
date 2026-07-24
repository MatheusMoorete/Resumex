# Arquitetura de qualidade de IA do ResumeX

## Objetivo

O produto deve gerar resumos e simulados fiéis ao material enviado, rastreáveis até a fonte e seguros para estudo. A prioridade é precisão; custo e latência são restrições secundárias.

## Princípios obrigatórios

1. Incertezas visuais são confirmadas pelo usuário; auditorias automáticas, quando habilitadas, usam provedor independente.
2. O PDF é a única fonte factual. Conhecimento externo do modelo não pode preencher lacunas.
3. Toda afirmação crítica deve ser rastreável até página ou trecho literal.
4. Conteúdo truncado, auditoria ausente ou evidência não localizada causa falha fechada.
5. Prompts ou comandos encontrados dentro de um PDF são dados não confiáveis e devem ser ignorados.
6. Modelos são escolhidos no servidor por função; o navegador não decide o provedor.

## Orquestração por complexidade

Antes de qualquer chamada de texto, o sistema executa uma análise local e gratuita do corpus:

| Nível | Execução |
| --- | --- |
| `invalid` | Bloqueia texto vazio, insuficiente, excessivamente repetitivo ou Lorem Ipsum sem chamar LLM |
| `simple` | DeepSeek V4 Flash/Pro, incluindo auditoria simples; não chama Kimi nem GPT |
| `standard` | DeepSeek gera e Kimi K3 audita |
| `high` | DeepSeek gera, Kimi audita e GPT-5.6 só pode adjudicar após falhas persistentes |

O score considera volume, páginas, arquivos, tabelas, valores/comparadores críticos, OCR, manuscritos e incertezas. A decisão e seus motivos ficam disponíveis no resultado técnico do pipeline.

## Roteamento atual

| Função | Papel de API | Modelo padrão |
| --- | --- | --- |
| SPEC do job de resumo | chamada interna do job | DeepSeek V4 Flash |
| Resumo final | chamada interna do job | DeepSeek V4 Pro |
| Extração e geração de questões | papéis internos `quiz-extract`, `quiz-generate` | DeepSeek V4 Flash/Pro |
| Auditoria de simulados | papel interno `quiz-audit` | Kimi K3 via OpenRouter, ou API direta |
| Adjudicação difícil de simulados | papel interno `quiz-audit-critical` | GPT-5.6 Terra Pro via OpenRouter, ou API direta |

O auditor primário é definido por `AI_PRIMARY_AUDITOR` no fluxo de simulado. O resumo usa uma revisão humana curta para resolver somente as leituras visuais incertas antes da geração final.

## Pipeline de resumo

1. Extrair texto nativo e blocos com coordenadas localmente usando PyMuPDF (escala Matrix 2.2, qualidade JPEG 92) e aplicar OCR local apenas em áreas/páginas com texto insuficiente.
2. Enviar ao GLM-4.5V somente as páginas visuais selecionadas, fornecendo junto a imagem em alta resolução e o texto nativo/OCR previamente extraído.
   - Se a página possuir texto nativo: solicitar apenas conteúdo visual adicional (manuscritos, diagramas, tabelas visuais e texto impresso interno a imagens/slides).
   - Se a página não possuir texto nativo: solicitar transcrição visual completa de todos os elementos visíveis.
3. Gerar uma SPEC concisa com DeepSeek Flash.
4. Pausar o job para o usuário revisar a SPEC e confirmar, corrigir ou ignorar cada dúvida diretamente sobre o trecho do PDF.
5. Gerar o resumo com DeepSeek Pro, aplicando as decisões humanas e exigindo citações de página `(p. X)`.
6. Executar validação determinística de cobertura por página (`getOmittedPages`). Se páginas com conteúdo substancial forem omitidas, disparar uma única chamada de reparo direcionado (`repairSummaryOmissions`) antes de finalizar.

## Pipeline de simulado

1. Receber os PDFs em job autenticado, validar tamanho/magic bytes e executar o worker PyMuPDF no servidor.
2. Detectar localmente páginas que precisam de visão e enviar ao GLM somente essas páginas, até o limite de 30.
3. Classificar arquivos em teoria, banco de questões ou misto.
4. Indexar o corpus em blocos sem cortar parágrafos e distribuir amostras pelo material.
5. Gerar candidatos conforme a complexidade: 1,5× no corpus simples, 1,8× no padrão e 2× no complexo.
6. Exigir `evidenceQuote` literal, arquivo e página em cada candidato.
7. Localizar a citação no corpus. Valores, unidades e comparadores exigem correspondência literal.
8. Auditar gabarito, unicidade, distratores e explicação usando somente a evidência fornecida.
9. Entregar apenas questões aprovadas com nota mínima. Questões reprovadas nunca completam o lote.

Os papéis de geração e auditoria de simulados não são aceitos pelo proxy público. Quantidade, modo, referências, corpus, páginas visuais, chamadas simultâneas e frequência de jobs são normalizados no servidor.

## Configuração

```env
DEEPSEEK_API_KEY=
ZHIPU_API_KEY=
# Opcional: usado apenas por fluxos com auditoria independente
KIMI_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=

DEEPSEEK_FLASH_MODEL=deepseek-v4-flash
DEEPSEEK_PRO_MODEL=deepseek-v4-pro
KIMI_AUDIT_MODEL=kimi-k3
OPENAI_AUDIT_MODEL=gpt-5.6-terra
OPENROUTER_AUDIT_MODEL=moonshotai/kimi-k3
OPENROUTER_CRITICAL_AUDIT_MODEL=openai/gpt-5.6-terra-pro
AI_ENABLE_GPT_AUDITOR=false
AI_PRIMARY_AUDITOR=openrouter
```

As chaves devem existir apenas no servidor. Chaves locais de DeepSeek/Zhipu continuam aceitas para desenvolvimento, mas auditores independentes são obrigatoriamente server-side.

## Observabilidade

Cada chamada emite um evento JSON `ai_usage` com papel, provedor, modelo, tokens de entrada/saída/cache, motivo de término e duração. Alertas recomendados:

- `finishReason=length`;
- queda da taxa de aprovação de questões;
- aumento de resumos que chegam à segunda correção;
- diferença anormal entre páginas do documento e páginas citadas;
- erro ou indisponibilidade do auditor.

## Critérios mínimos de aceite

- Um resumo com página omitida não pode chegar à tela de resultado.
- Um resumo truncado não pode ser publicado.
- Uma questão sem evidência literal localizada não pode ser entregue.
- Uma questão reprovada pelo auditor não pode ser usada para completar quantidade.
- Trocar o modelo de um papel deve exigir apenas configuração de servidor.
- PDFs contendo instruções para o modelo não podem alterar o comportamento do pipeline.

## Próxima camada recomendada

Antes de liberar em escala, montar um conjunto ouro versionado de PDFs e respostas revisadas por professores. Executar avaliações offline a cada alteração de prompt/modelo, medindo cobertura factual, fidelidade de números/comparadores, precisão dos gabaritos, ambiguidade e taxa de aprovação humana. Nenhuma troca de modelo deve ir para produção sem superar ou igualar a versão anterior nesse conjunto.
