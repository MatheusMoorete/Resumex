export type AiComplexityTier = 'invalid' | 'simple' | 'standard' | 'high';

export type CorpusComplexity = {
  tier: AiComplexityTier;
  score: number;
  reasons: string[];
  stats: {
    characters: number;
    words: number;
    pages: number;
    files: number;
    criticalSignals: number;
  };
};

type CorpusComplexityInput = {
  text: string;
  numPages?: number;
  fileCount?: number;
  hasVision?: boolean;
};

const PLACEHOLDER_WORDS = new Set([
  'lorem', 'ipsum', 'dolor', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'labore', 'dolore',
  'magna', 'aliqua', 'enim', 'veniam', 'quis', 'nostrud', 'ullamco',
]);

const CRITICAL_PATTERN = /\b(?:mg|mcg|ml|mmhg|kg|dose|dosagem|conduta|tratamento|diagn[oó]stico|protocolo|crit[eé]rio|contraindica|emerg[eê]ncia|cirurgia|press[aã]o|tempo|limiar)\b|\d|[<>=\u2264\u2265]/gi;
const UNCERTAINTY_PATTERN = /(?:manuscrito|ileg[ií]vel|incerto|duvidoso|falha de transcri[cç][aã]o|conflito|ocr)/gi;
const TABLE_PATTERN = /(?:^|\n)\s*\|[^\n]+\|\s*(?:\n|$)/g;

function normalizedWords(text: string) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z]{2,}/g) || [];
}

export function assessCorpusComplexity({
  text,
  numPages = 0,
  fileCount = 1,
  hasVision = false,
}: CorpusComplexityInput): CorpusComplexity {
  const source = String(text || '').trim();
  const words = normalizedWords(source);
  const placeholderCount = words.filter((word) => PLACEHOLDER_WORDS.has(word)).length;
  const placeholderRatio = words.length ? placeholderCount / words.length : 0;
  const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
  const criticalSignals = (source.match(CRITICAL_PATTERN) || []).length;
  const uncertaintySignals = (source.match(UNCERTAINTY_PATTERN) || []).length;
  const tables = (source.match(TABLE_PATTERN) || []).length;
  const reasons: string[] = [];

  const invalidReason = source.length < 80 || words.length < 15
    ? 'O documento não possui texto suficiente para gerar conteúdo confiável.'
    : /\blorem\s+ipsum\b/i.test(source) || (placeholderCount >= 5 && placeholderRatio >= 0.18)
      ? 'O documento contém texto de preenchimento (Lorem Ipsum), não material de estudo.'
      : words.length >= 100 && uniqueRatio < 0.04
        ? 'O documento contém texto excessivamente repetitivo e sem conteúdo suficiente.'
        : '';

  if (invalidReason) {
    return {
      tier: 'invalid',
      score: 0,
      reasons: [invalidReason],
      stats: { characters: source.length, words: words.length, pages: numPages, files: fileCount, criticalSignals },
    };
  }

  let score = 0;
  if (numPages >= 20) { score += 2; reasons.push('documento longo'); }
  else if (numPages >= 6) { score += 1; reasons.push('documento com várias páginas'); }
  if (source.length >= 80000) { score += 2; reasons.push('alto volume de texto'); }
  else if (source.length >= 20000) { score += 1; reasons.push('volume moderado de texto'); }
  if (criticalSignals >= 12) { score += 2; reasons.push('muitos valores ou termos clínicos críticos'); }
  else if (criticalSignals > 0) { score += 1; reasons.push('presença de valores ou termos clínicos'); }
  if (uncertaintySignals > 0) { score += 2; reasons.push('OCR, manuscrito ou conteúdo incerto'); }
  if (hasVision) { score += 2; reasons.push('leitura visual necessária'); }
  if (fileCount > 1) { score += 1; reasons.push('múltiplos arquivos'); }
  if (tables >= 3) { score += 1; reasons.push('múltiplas tabelas'); }

  const tier: AiComplexityTier = score <= 1 ? 'simple' : score <= 4 ? 'standard' : 'high';
  return {
    tier,
    score,
    reasons: reasons.length ? reasons : ['texto curto sem sinais de alto risco'],
    stats: { characters: source.length, words: words.length, pages: numPages, files: fileCount, criticalSignals },
  };
}
