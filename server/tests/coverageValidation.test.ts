import { describe, expect, it } from 'vitest';
import { cleanSummaryOutput, extractCitedPages, getOmittedPages, visualJson } from '../summaryJobs.js';

describe('Page Coverage Validation', () => {
  it('should correctly extract single page citations', () => {
    const summary = 'Este é um ponto crítico (p. 1) e outro ponto importante (pág. 3).';
    const cited = extractCitedPages(summary);
    expect(cited.has(1)).toBe(true);
    expect(cited.has(3)).toBe(true);
    expect(cited.has(2)).toBe(false);
  });

  it('should correctly extract page ranges and comma-separated lists', () => {
    const summary = 'Diretrizes clínicas (p. 4-6) e condutas adicionais (p. 1, 2, 8).';
    const cited = extractCitedPages(summary);
    expect(cited.has(1)).toBe(true);
    expect(cited.has(2)).toBe(true);
    expect(cited.has(4)).toBe(true);
    expect(cited.has(5)).toBe(true);
    expect(cited.has(6)).toBe(true);
    expect(cited.has(8)).toBe(true);
    expect(cited.has(3)).toBe(false);
  });

  it('should identify omitted pages with substantial text', () => {
    const pages = [
      { page: 1, text: 'Página 1 com texto longo suficiente para ser relevante no resumo.' },
      { page: 2, text: 'Página 2 também possui conteúdo relevante e muito extenso.' },
      { page: 3, text: 'Página 3 com texto substancial que foi esquecido.' },
      { page: 4, text: 'Curto' },
    ];
    const summary = 'Resumo cobrindo a primeira parte (p. 1) e a segunda parte (p. 2).';
    const omitted = getOmittedPages(pages, summary);
    expect(omitted.map((p) => p.page)).toEqual([3]);
  });

  it('should parse GLM response robustly even with conversational intro text or missing confidence', () => {
    const glmOutputWithIntro = `Aqui está a análise da página 2:\n\`\`\`json\n{\n  "visualContent": "Linha do tempo: 1883 Bismarckiano, 1923 CAPs, 1930 Era Vargas",\n  "handwriting": "combate as epidemias / coordenação de danos"\n}\n\`\`\``;
    const res = visualJson(glmOutputWithIntro);
    expect(res.visualContent).toContain('1883 Bismarckiano');
    expect(res.handwriting).toContain('combate as epidemias');
    expect(res.confidence).toBe(0.9);
    expect(res.uncertainties).toHaveLength(0);
  });

  it('should clean summary preambles effectively', () => {
    const dirtySummary = 'Aqui está o resumo estruturado do documento, seguindo rigorosamente as regras.\n\n# Tipologias dos Sistemas de Saúde\n\nConteúdo...';
    const cleaned = cleanSummaryOutput(dirtySummary);
    expect(cleaned).toBe('# Tipologias dos Sistemas de Saúde\n\nConteúdo...');
  });
});
