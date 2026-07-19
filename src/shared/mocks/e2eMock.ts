export const mockSummary = `# Resumo E2E ResumeX

## Diagnostico sindromico

Este resumo e um mock local para validar a exportacao ao Notion sem consumir tokens de IA. A estrutura usa headings, listas, negrito, italico, codigo e link para testar a conversao de Markdown em blocos do Notion (p. 1).

## Pontos principais

- **Achado central:** paciente simulado com quadro de teste para validar o fluxo de exportacao (p. 1).
- *Conduta inicial:* confirmar que a pagina aparece no Notion com blocos separados (p. 1).
- \`Campo tecnico\`: valida rich text inline e code span (p. 1).
- Link de referencia: [ResumeX](https://resumex-gamma.vercel.app) (p. 1).

## Tabela de validacao

| Item | Esperado |
| --- | --- |
| Heading | Criar titulo/secao |
| Bullet | Criar item de lista |
| Negrito | Preservar enfase |
| Link | Criar rich text com URL |

> Bloco de citacao para confirmar suporte a quote no Notion (p. 1).

---

## Relatorio de cobertura

- Paginas cobertas: 1/1.
- Status: mock E2E gerado localmente.
`;

export const mockEvidenceMap = `## Página 1

### Conceitos centrais
- Material clínico simulado para validar o fluxo local.
- Toda informação permanece vinculada à página de origem.`;

export const mockSpec = `# Plano do resumo

## 1. Visão geral
- Contextualizar o tema e os objetivos do material.

## 2. Pontos principais
- Organizar conceitos, critérios e condutas em tópicos.
- Preservar a referência da página de origem.

## 3. Revisão
- Encerrar com perguntas para recordação ativa.`;

export const mockSpecAudit = `**Status:** APROVADA

O plano cobre o material de teste, preserva as referências e está pronto para revisão.`;

export const mockSummaryLog = `## Auditoria local

**Status:** APROVADO

Fixture validada sem chamadas externas.`;

export const mockFlashcardDrafts = [
  { front: 'Qual é o objetivo do modo de teste local?', back: 'Validar todo o fluxo sem enviar um PDF ou consumir APIs.' },
  { front: 'O material de teste funciona em produção?', back: 'Não. Ele fica disponível apenas em desenvolvimento no localhost.' },
];

export function createMockFileData() {
  return {
    file: null,
    name: 'mock-e2e-resumex.pdf',
    size: 1024,
    numPages: 1,
    text: 'Conteudo mock para teste E2E local.',
    pageTexts: ['Conteudo mock para teste E2E local.'],
    pageMetadata: [
      {
        pageNum: 1,
        text: 'Conteudo mock para teste E2E local.',
        needsVision: false,
      },
    ],
    pdfUrl: '',
    contextBase: '--- Pagina 1 ---\nConteudo mock para teste E2E local.',
  };
}
