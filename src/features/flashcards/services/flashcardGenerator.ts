import { generateSummary } from '../../summary/services/deepseekApi';
import type { FlashcardDraft } from '../domain/flashcards';

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

export async function generateFlashcardsFromSummary({
  apiKey,
  summary,
  signal,
}: {
  apiKey?: string;
  summary: string;
  signal?: AbortSignal;
}): Promise<FlashcardDraft[]> {
  const response = await generateSummary({
    apiKey,
    role: 'flashcards',
    pdfText: summary,
    signal,
    onChunk: () => undefined,
    systemPrompt: `Você transforma um resumo médico em flashcards de recuperação ativa.

Regras:
- Use somente informações presentes no resumo.
- Crie cartões atômicos: uma pergunta ou conceito por cartão.
- Preserve literalmente doses, unidades, comparadores, critérios e valores.
- Não invente explicações nem complete lacunas com conhecimento externo.
- Evite perguntas vagas, listas excessivamente longas e cartões duplicados.
- Gere de 10 a 30 cartões, conforme o volume real de conteúdo.
- Responda apenas JSON válido, sem Markdown.

Formato obrigatório:
{"cards":[{"front":"Pergunta curta","back":"Resposta objetiva"}]}`,
  });

  const payload = parseJson(response);
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  return cards
    .map((card) => ({ front: String(card?.front || '').trim(), back: String(card?.back || '').trim() }))
    .filter((card) => card.front && card.back)
    .slice(0, 60);
}
