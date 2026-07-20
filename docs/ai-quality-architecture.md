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
| Mapa de evidências, SPEC, correção de SPEC | `evidence`, `spec`, `spec-correction` | DeepSeek V4 Flash |
| Resumo, reparo de resumo | `summary`, `summary-repair` | DeepSeek V4 Pro |
| Extração e geração de questões | `quiz-extract`, `quiz-generate` | DeepSeek V4 Flash/Pro |
| Auditorias do fluxo legado e simulados | `spec-audit`, `summary-audit`, `quiz-audit` | Kimi K3 via OpenRouter, ou API direta |
| Adjudicação difícil | `spec-audit-critical`, `summary-audit-critical`, `quiz-audit-critical` | GPT-5.6 Terra Pro via OpenRouter, ou API direta |

O auditor primário é definido por `AI_PRIMARY_AUDITOR` nos fluxos legados e de simulado. O resumo otimizado não exige Kimi: ele usa uma revisão humana curta para resolver somente as leituras visuais incertas antes da geração final.

## Pipeline de resumo

1. Extrair texto localmente com PyMuPDF e tentar OCR local apenas nas páginas sem texto suficiente.
2. Enviar ao GLM somente as páginas visuais selecionadas e pedir a posição normalizada de cada leitura incerta.
3. Gerar uma SPEC concisa com DeepSeek Flash.
4. Pausar o job para o usuário revisar a SPEC e confirmar, corrigir ou ignorar cada dúvida diretamente sobre o trecho do PDF.
5. Gerar o resumo uma única vez com DeepSeek Pro, aplicando as decisões humanas e exigindo citações de página.

O Kimi não participa automaticamente deste fluxo. Isso elimina a chamada de auditoria visual que mais elevava o custo, sem transformar uma leitura incerta em fato silenciosamente.

## Pipeline de simulado

1. Classificar arquivos em teoria, banco de questões, misto ou dependente de visão.
2. Indexar o corpus em blocos sem cortar parágrafos sempre que possível.
3. Distribuir blocos ao longo do material para evitar viés para as primeiras páginas.
4. Gerar mais candidatos do que o número solicitado.
5. Exigir `evidenceQuote` literal, arquivo e página em cada candidato.
6. Localizar a citação no corpus. Valores, unidades e comparadores exigem correspondência literal.
7. Auditar gabarito, unicidade, distratores e explicação usando somente a evidência fornecida.
8. Entregar apenas questões aprovadas com nota mínima. Questões reprovadas nunca completam o lote.

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
