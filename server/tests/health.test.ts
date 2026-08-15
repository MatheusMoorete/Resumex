import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { normalizeNotionPageId, chunkText, getNotionTitle } from '../src/routes/notion.js';
import {
  normalizeAiPayload,
  PUBLIC_AI_ROLES,
  resolveAiRoute,
  sanitizeAiMessages,
} from '../src/routes/aiProxy.js';
import { getClientId } from '../src/middlewares/rateLimit.js';
import { normalizePreferences, preferenceInstructions } from '../summaryJobs.js';
import { normalizeQuizOptions, normalizeQuizSummarySource } from '../quizJobs.js';
import { normalizeFlashcardCount } from '../flashcardJobs.js';
import { validateFlashcardCandidates } from '../src/services/flashcardGeneration.js';
import { applyVisualAnswers, getVisualQuestions } from '../src/services/studyCorpus.js';
import { verifyQuestionEvidence } from '../../src/features/quiz/services/quizApi.js';

describe('Server Modular Health & Utilities (TypeScript)', () => {
  it('should export Express app instance', () => {
    expect(app).toBeDefined();
    expect(typeof app).toBe('function');
  });

  it('should normalize Notion page IDs correctly', () => {
    const rawId = '1234567890abcdef1234567890abcdef';
    const normalized = normalizeNotionPageId(rawId);
    expect(normalized).toBe('12345678-90ab-cdef-1234-567890abcdef');
  });

  it('should chunk text into parts', () => {
    const text = 'A'.repeat(5000);
    const chunks = chunkText(text, 1900);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(1900);
    expect(chunks[1].length).toBe(1900);
    expect(chunks[2].length).toBe(1200);
  });

  it('should extract title from markdown heading', () => {
    const markdown = '# Resumo de Cardiologia\n\nConteúdo sobre infarto...';
    const title = getNotionTitle(markdown, 'Fallback');
    expect(title).toBe('Resumo de Cardiologia');
  });

  it('should reject the removed legacy summary route', () => {
    expect(resolveAiRoute('summary')).toBeNull();
  });

  it('should return null for invalid AI role', () => {
    const route = resolveAiRoute('invalid-role-xyz');
    expect(route).toBeNull();
  });

  it('should route vision through the bounded orchestrator', () => {
    const route = resolveAiRoute('vision');
    expect(route?.providerName).toBe('zhipu');
  });

  it('should keep quiz generation roles private to server jobs', () => {
    expect(PUBLIC_AI_ROLES.has('quiz-generate')).toBe(false);
    expect(PUBLIC_AI_ROLES.has('quiz-audit')).toBe(false);
    expect(PUBLIC_AI_ROLES.has('flashcard-generate')).toBe(false);
    expect(resolveAiRoute('flashcard-generate')?.model).toContain('flash');
    expect(resolveAiRoute('flashcard-generate-complex')?.model).toContain('pro');
  });

  it('should cap output and discard arbitrary provider options', () => {
    const payload = normalizeAiPayload({
      messages: [{ role: 'user', content: 'Crie cartões.' }],
      max_tokens: 999_999,
      temperature: 9,
      n: 100,
      tools: [{ type: 'function' }],
    }, { providerName: 'deepseek', model: 'test-model' }, 'flashcard-generate');

    expect(payload.max_tokens).toBe(8192);
    expect(payload.temperature).toBe(0.5);
    expect(payload.n).toBeUndefined();
    expect(payload.tools).toBeUndefined();
  });

  it('should reject oversized AI input', () => {
    expect(() => sanitizeAiMessages('flashcard-generate', [
      { role: 'user', content: 'A'.repeat(600_001) },
    ])).toThrow(/character limit/);
  });

  it('should rate limit authenticated users by user id', () => {
    expect(getClientId({
      authUser: { id: 'user-123' },
      ip: '127.0.0.1',
    } as any)).toBe('user-123');
  });

  it('should turn summary preferences into explicit server instructions', () => {
    const instructions = preferenceInstructions({
      method: 'clinical',
      formats: ['text'],
      detailLevel: 'concise',
    });

    expect(instructions).toContain('definição, achados, critérios, conduta');
    expect(instructions).toContain('Não use tabelas');
    expect(instructions).toContain('evite listas longas');
    expect(instructions).not.toContain('perguntas de recuperação ativa');
  });

  it('should ignore flashcards and limit summary formats to two', () => {
    expect(normalizePreferences({
      formats: [{ id: 'bullets' }, { id: 'flashcards' }, { id: 'tables' }, { id: 'qa' }],
    }).formats).toEqual(['bullets', 'tables']);
  });

  it('should bound quiz job options and reference questions', () => {
    const options = normalizeQuizOptions({
      questionCount: 999,
      questionMode: 'anything',
      practiceMode: 'focused',
      previousQuestions: Array.from({ length: 100 }, (_, index) => ({
        stem: `Questão ${index}`,
        explanation: 'A'.repeat(5000),
      })),
    });

    expect(options.questionCount).toBe(15);
    expect(options.questionMode).toBe('generated_only');
    expect(options.previousQuestions).toHaveLength(45);
    expect(options.previousQuestions[0].explanation).toHaveLength(1200);
  });

  it('should accept a bounded summary as a quiz source', () => {
    expect(normalizeQuizSummarySource({ name: 'Resumo.md', text: '  Conteúdo rastreável (p. 2).  ' })).toEqual({
      name: 'Resumo.md',
      text: 'Conteúdo rastreável (p. 2).',
    });
    expect(normalizeQuizSummarySource({ name: '   ', text: 'Conteúdo válido.' })?.name).toBe('Resumo atual.md');
    expect(normalizeQuizSummarySource({ text: 'A'.repeat(180_001) })).toBeNull();
  });

  it('should validate grounded flashcards and preserve critical numbers', () => {
    const files = [{
      name: 'venosas.pdf',
      size: 100,
      numPages: 1,
      pageTexts: ['A compressão recomendada no material é de 30 mmHg para este caso clínico.'],
      text: 'A compressão recomendada no material é de 30 mmHg para este caso clínico.',
      readMode: 'text' as const,
      requiresVision: false as const,
    }];
    const raw = { cards: [
      {
        front: 'Qual é a compressão recomendada?',
        back: '30 mmHg.',
        sourceName: 'venosas.pdf',
        sourcePage: 1,
        evidenceQuote: 'A compressão recomendada no material é de 30 mmHg para este caso clínico.',
      },
      {
        front: 'Qual é a compressão incorreta?',
        back: '40 mmHg.',
        sourceName: 'venosas.pdf',
        sourcePage: 1,
        evidenceQuote: 'A compressão recomendada no material é de 30 mmHg para este caso clínico.',
      },
    ] };

    const cards = validateFlashcardCandidates(raw, files, 'pdf', 20);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ sourceType: 'pdf', sourcePage: 1, back: '30 mmHg.' });
    expect(normalizeFlashcardCount(999)).toBe(20);
  });

  it('should require and apply human confirmation for uncertain visual text', () => {
    const pages = [{
      page: 3,
      sourceName: 'anotacoes.pdf',
      visual: {
        confidence: 0.4,
        handwriting: 'dose possivelmente 20 mg',
        visualContent: '',
        uncertainties: [],
      },
    }];

    const questions = getVisualQuestions(pages);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ id: 'p3-q1', page: 3 });

    applyVisualAnswers(pages, [{ id: 'p3-q1', action: 'correct', value: 'dose confirmada 10 mg' }]);
    expect(pages[0].visual.handwriting).toBe('dose confirmada 10 mg');
    expect(pages[0].visual.uncertainties).toEqual([]);
    expect(pages[0].visual.confidence).toBe(0.9);
  });

  it('should verify quiz evidence on the declared file and page', () => {
    const files = [{
      name: 'cardiologia.pdf',
      pageTexts: ['A dose inicial é 100 mg por via oral.', 'Conduta de acompanhamento.'],
      text: 'A dose inicial é 100 mg por via oral.\nConduta de acompanhamento.',
    }];
    const question = {
      sourceFile: 'cardiologia.pdf',
      sourcePage: '2',
      evidenceQuote: 'A dose inicial é 100 mg por via oral.',
    };

    expect(verifyQuestionEvidence(question, files).evidenceVerified).toBe(false);
    expect(verifyQuestionEvidence({ ...question, sourcePage: '1' }, files).evidenceVerified).toBe(true);
  });
});
