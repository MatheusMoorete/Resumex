import { buildAuthHeaders } from './authClient';

const API_URL = '/api/deepseek/chat/completions';
const MAX_CONTEXT_CHARS = 70000;
const MAX_FILE_CHARS = 24000;
const MAX_QUESTIONS_PER_CALL = 10;
const MAX_CHUNK_CHARS = 4500;
const AUDIT_BATCH_SIZE = 12;
const MIN_AUDIT_SCORE = 78;
const FINAL_SIMILARITY_THRESHOLD = 0.58;
const RELAXED_SIMILARITY_THRESHOLD = 0.72;

const WINDOWS_1252_BYTE_BY_CODE_POINT = {
  0x20AC: 0x80,
  0x201A: 0x82,
  0x0192: 0x83,
  0x201E: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02C6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8A,
  0x2039: 0x8B,
  0x0152: 0x8C,
  0x017D: 0x8E,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201C: 0x93,
  0x201D: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02DC: 0x98,
  0x2122: 0x99,
  0x0161: 0x9A,
  0x203A: 0x9B,
  0x0153: 0x9C,
  0x017E: 0x9E,
  0x0178: 0x9F,
};

const TOPIC_RULES = [
  { topic: 'AVC isquemico e trombolise', keywords: ['avc isqu', 'trombol', 'nihss', 'ictus', 'wake-up', 'dwi', 'flair', 'alteplase', 'tenecteplase'] },
  { topic: 'AVC hemorragico, HIP e HSA', keywords: ['hemorragia', 'hip', 'hsa', 'subaracn', 'intraparenquimatosa', 'nimodipina', 'hunt-hess', 'vasoespasmo'] },
  { topic: 'TCE e neurotrauma', keywords: ['tce', 'traumatismo', 'glasgow', 'epidural', 'subdural', 'axonal', 'craniectomia', 'morte encefalica'] },
  { topic: 'Tumores neurologicos', keywords: ['tumor', 'glioma', 'meningioma', 'metastase', 'neoplasia', 'astrocitoma', 'glioblastoma'] },
  { topic: 'Dor e neurocirurgia funcional', keywords: ['dor', 'trigem', 'neuralgia', 'rizotomia', 'estimula', 'funcional', 'neuromodula'] },
  { topic: 'Coluna e medula', keywords: ['coluna', 'medula', 'radicul', 'mielopatia', 'hernia', 'estenose', 'compressao medular'] },
  { topic: 'Hidrocefalia e hipertensao intracraniana', keywords: ['hidrocefalia', 'pic', 'dve', 'dvp', 'hipertensao intracraniana', 'liquor'] },
  { topic: 'Fossa posterior, AIT e vertigem', keywords: ['fossa posterior', 'ait', 'hints', 'vertigem', 'ataxia', 'nistagmo'] },
];

function extractJsonObject(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : source;
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('A IA nao retornou um JSON valido para o teste.');
  }

  const candidate = jsonText.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    return repairAndParseQuizJson(candidate, error);
  }
}

function repairAndParseQuizJson(candidate, originalError) {
  const normalized = candidate
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  try {
    return JSON.parse(normalized);
  } catch {}

  const questionsKey = normalized.match(/"questions"\s*:\s*\[/);
  if (!questionsKey) throw originalError;

  const start = questionsKey.index + questionsKey[0].length - 1;
  const items = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let index = start + 1; index < normalized.length; index++) {
    const char = normalized[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && objectStart !== -1) {
        const objectText = normalized.slice(objectStart, index + 1).replace(/,\s*([}\]])/g, '$1');
        try {
          items.push(JSON.parse(objectText));
        } catch {}
        objectStart = -1;
      }
      continue;
    }

    if (depth === 0 && char === ']') break;
  }

  if (items.length === 0) throw originalError;
  return { questions: items };
}

function mojibakeScore(text) {
  return countMatches(text, /[\u00c2\u00c3\u00e2\u0192\u0080-\u009f]/g);
}

function decodeMojibakePass(text) {
  if (typeof TextDecoder === 'undefined') return text;

  const bytes = [];
  for (const char of String(text || '')) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else if (WINDOWS_1252_BYTE_BY_CODE_POINT[codePoint]) {
      bytes.push(WINDOWS_1252_BYTE_BY_CODE_POINT[codePoint]);
    } else {
      return text;
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

function repairMojibakeToken(token) {
  let repaired = String(token || '');

  for (let index = 0; index < 3; index++) {
    const decoded = decodeMojibakePass(repaired);
    if (!decoded || decoded === repaired) break;
    if (mojibakeScore(decoded) > mojibakeScore(repaired)) break;
    repaired = decoded;
  }

  return repaired
    .replace(/\u00a0/g, ' ')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

function cleanText(value) {
  return String(value || '')
    .replace(/\S*[\u00c2\u00c3\u00e2\u0192]\S*/g, (token) => repairMojibakeToken(token))
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeCorpusFiles(files) {
  return files.map((file) => ({
    ...file,
    name: cleanText(file.name),
    text: cleanText(file.text),
    pageTexts: Array.isArray(file.pageTexts) ? file.pageTexts.map(cleanText) : file.pageTexts,
  }));
}

function truncateText(text, maxChars) {
  const source = cleanText(text);
  if (source.length <= maxChars) return source;
  return `${source.slice(0, maxChars)}\n\n[Texto truncado para caber no contexto do modelo]`;
}

function compactContext(parts, maxChars = MAX_CONTEXT_CHARS) {
  let used = 0;
  const compacted = [];

  for (const part of parts) {
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const slice = truncateText(part, remaining);
    compacted.push(slice);
    used += slice.length;
  }

  return compacted.join('\n\n---\n\n');
}

function countMatches(text, pattern) {
  return (String(text || '').match(pattern) || []).length;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferTopic(text, fileName = '') {
  const normalized = normalizeText(`${fileName}\n${text}`);
  let best = { topic: 'Geral', score: 0 };

  for (const rule of TOPIC_RULES) {
    const score = rule.keywords.reduce((total, keyword) => (
      normalized.includes(normalizeText(keyword)) ? total + 1 : total
    ), 0);
    if (score > best.score) best = { topic: rule.topic, score };
  }

  if (best.score > 0) return best.topic;

  const heading = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 4 && line.length <= 80 && !/^[-*]/.test(line));

  return heading || 'Geral';
}

function splitTextByPages(text) {
  const source = cleanText(text);
  const pageRegex = /---\s*P(?:a|\u00e1)gina\s+(\d+)\s*---/gi;
  const pages = [];
  const matches = [...source.matchAll(pageRegex)];

  if (matches.length === 0) {
    return [{ page: null, text: source }];
  }

  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    pages.push({
      page: Number(match[1]),
      text: source.slice(start, end).trim(),
    });
  });

  return pages;
}

function splitLongChunk(text, maxChars = MAX_CHUNK_CHARS) {
  const source = String(text || '').trim();
  if (source.length <= maxChars) return [source];

  const chunks = [];
  for (let index = 0; index < source.length; index += maxChars) {
    chunks.push(source.slice(index, index + maxChars));
  }
  return chunks;
}

function buildContentIndex(files) {
  const chunks = [];

  files.forEach((file) => {
    const pages = splitTextByPages(file.text);
    pages.forEach((page) => {
      splitLongChunk(page.text).forEach((chunkText, chunkIndex) => {
        if (chunkText.trim().length < 80) return;
        chunks.push({
          id: `${file.name}-p${page.page || 'x'}-${chunkIndex}`,
          fileName: file.name,
          page: page.page,
          kind: file.kind,
          topic: inferTopic(chunkText, file.name),
          text: chunkText,
        });
      });
    });
  });

  return chunks;
}

export function classifyQuizFiles(files) {
  return files.map((file) => {
    const text = String(file.text || '').slice(0, 40000);
    const normalized = normalizeText(text);
    const textLength = text.replace(/---[^\n]*---/g, '').trim().length;
    const questionSignals = [
      countMatches(normalized, /quest(?:ao|oes)\s*\d+/g) * 3,
      countMatches(text, /\b[a-e]\)\s+\S/gi) * 2,
      countMatches(text, /\b[a-e][\.\-]\s+\S/gi),
      countMatches(text, /(?:^|\n)\s*\d{1,3}[\.\)]\s+\S/gm),
      countMatches(normalized, /gabarito|resposta correta|alternativa correta|comentario|enunciado/g) * 2,
    ].reduce((sum, value) => sum + value, 0);
    const theorySignals = [
      countMatches(text, /^#{1,3}\s+/gm) * 2,
      countMatches(normalized, /definicao|etiologia|diagnostico|tratamento|conduta|classificacao|fisiopatologia/g),
      countMatches(normalized, /---\s*pagina\s+\d+/g),
    ].reduce((sum, value) => sum + value, 0);

    let kind = 'theory';
    if ((file.requiresVision || file.readMode === 'visual') && textLength < 300) {
      kind = 'needs_vision';
    } else if (questionSignals >= 12 && questionSignals >= theorySignals) {
      kind = 'question_bank';
    } else if (questionSignals >= 8 && theorySignals >= 6) {
      kind = 'mixed';
    }

    return {
      ...file,
      kind,
      textLength,
      questionSignals,
      theorySignals,
    };
  });
}

function buildFileContext(file, label) {
  return `# ${label}: ${file.name}\nTipo detectado: ${file.kind}\nPaginas: ${file.numPages}\n\n${truncateText(file.text, MAX_FILE_CHARS)}`;
}

function buildTheoryContext(files, { includeQuestionBanksAsStyle = false } = {}) {
  const theoryFiles = files.filter((file) => (
    file.kind === 'theory'
    || file.kind === 'mixed'
    || (includeQuestionBanksAsStyle && file.kind === 'question_bank')
  ));
  const sourceFiles = theoryFiles.length ? theoryFiles : files;
  return compactContext(sourceFiles.map((file, index) => buildFileContext(file, `MATERIAL TEORICO ${index + 1}`)));
}

function buildChunkContext(chunks, label = 'BLOCO') {
  return compactContext(chunks.map((chunk, index) => (
    `# ${label} ${index + 1}: ${chunk.topic}\nArquivo: ${chunk.fileName}${chunk.page ? ` | Pagina: ${chunk.page}` : ''}\nTipo: ${chunk.kind}\n\n${truncateText(chunk.text, MAX_CHUNK_CHARS)}`
  )));
}

function buildQuestionBankContext(files) {
  const questionFiles = files.filter((file) => file.kind === 'question_bank' || file.kind === 'mixed');
  return compactContext(questionFiles.map((file, index) => buildFileContext(file, `BANCO DE QUESTOES ${index + 1}`)));
}

async function callDeepSeekJson({ apiKey, system, user, signal, maxTokens = 8192, temperature = 0.25 }) {
  const headers = {
    'Content-Type': 'application/json',
    ...await buildAuthHeaders(),
  };
  if (apiKey) {
    headers['X-Provider-Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      temperature,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = errorBody;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error?.message || parsed.message || errorBody;
    } catch {}
    throw new Error(`Erro ao gerar teste (${response.status}): ${errorMessage}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return extractJsonObject(content);
}

function normalizeQuestions(payload, origin) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];

  return questions
    .map((question, index) => ({
      id: `${origin}-${question.id || index + 1}`,
      origin,
      stem: cleanText(question.stem),
      options: Array.isArray(question.options)
        ? question.options.map((option) => cleanText(option)).filter(Boolean).slice(0, 5)
        : [],
      answerIndex: Number(question.answerIndex),
      explanation: cleanText(question.explanation),
      topic: cleanText(question.topic),
      source: cleanText(question.source),
      sourceFile: cleanText(question.sourceFile),
      sourcePage: question.sourcePage ? cleanText(question.sourcePage) : '',
    }))
    .filter((question) => (
      question.stem
      && question.options.length >= 2
      && Number.isInteger(question.answerIndex)
      && question.answerIndex >= 0
      && question.answerIndex < question.options.length
    ));
}

function normalizeAuditItems(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return items
    .map((item) => ({
      id: String(item.id || '').trim(),
      approved: Boolean(item.approved),
      score: Number(item.score) || 0,
      issue: cleanText(item.issue),
      topic: cleanText(item.topic),
    }))
    .filter((item) => item.id);
}

function buildSkipList(questions) {
  return questions
    .map((question, index) => `${index + 1}. ${question.stem.slice(0, 180)}`)
    .join('\n');
}

function stemTokens(stem) {
  const stopwords = new Set([
    'sobre', 'qual', 'quais', 'assinale', 'alternativa', 'correta', 'incorreta',
    'paciente', 'apresenta', 'em', 'de', 'da', 'do', 'das', 'dos', 'para', 'com',
    'uma', 'um', 'que', 'e', 'o', 'a', 'os', 'as', 'no', 'na', 'nos', 'nas',
    'anos', 'entrada', 'admissao', 'mostra', 'principal', 'conduta', 'adequada',
    'seguinte', 'diagnostico', 'provavel', 'mais',
  ]);

  return normalizeText(stem)
    .split(' ')
    .filter((token) => token.length > 3 && !stopwords.has(token));
}

function questionSimilarity(a, b) {
  const aTokens = new Set(stemTokens(`${a.topic || ''} ${a.stem}`));
  const bTokens = new Set(stemTokens(`${b.topic || ''} ${b.stem}`));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) intersection += 1;
  });

  const smaller = Math.min(aTokens.size, bTokens.size);
  return intersection / smaller;
}

function areSimilarQuestions(a, b, threshold = 0.68) {
  return questionSimilarity(a, b) >= threshold;
}

function dedupeQuestions(questions) {
  const seen = new Set();
  const unique = [];

  for (const question of questions) {
    const key = normalizeText(question.stem).slice(0, 180);

    if (!key || seen.has(key)) continue;
    if (unique.some((existing) => areSimilarQuestions(existing, question))) continue;

    seen.add(key);
    unique.push(question);
  }

  return unique;
}

async function extractExistingQuestionsBatch({ apiKey, files, theoryContext, questionCount, usedQuestions, signal }) {
  const questionBankContext = buildQuestionBankContext(files);
  if (!questionBankContext.trim()) return [];
  const skipList = buildSkipList(usedQuestions);

  const payload = await callDeepSeekJson({
    apiKey,
    signal,
    temperature: 0.15,
    system: `Voce extrai questoes de bancos de prova em PDFs medicos.

Objetivo:
- Preserve questoes existentes quando houver enunciado e alternativas.
- Se houver gabarito/comentario no banco, use-o.
- Se nao houver gabarito claro, resolva usando o material teorico fornecido.
- Nao invente questoes nesta etapa; apenas extraia questoes existentes.
- Corrija apenas formatacao quebrada de PDF.
- Responda somente JSON valido.
- Nao use Markdown, comentarios, trailing commas nem texto antes/depois do JSON.`,
    user: `Extraia ate ${questionCount} questoes existentes dos bancos abaixo.

Evite extrair questoes iguais ou muito parecidas com estas ja usadas:
${skipList || 'Nenhuma.'}

Formato obrigatorio:
{
  "questions": [
    {
      "id": "ext1",
      "stem": "Enunciado completo",
      "options": ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"],
      "answerIndex": 0,
      "explanation": "Explicacao curta usando o gabarito ou o material teorico.",
      "topic": "Tema",
      "sourceFile": "Nome do PDF",
      "sourcePage": "pagina se identificavel",
      "source": "Arquivo/pagina"
    }
  ]
}

## MATERIAL TEORICO PARA EXPLICAR/RESOLVER QUANDO NECESSARIO

${theoryContext}

## BANCOS DE QUESTOES

${questionBankContext}`,
  });

  return normalizeQuestions(payload, 'extracted').slice(0, questionCount);
}

async function extractExistingQuestions({ apiKey, files, theoryContext, questionCount, signal }) {
  const collected = [];

  while (collected.length < questionCount) {
    const batchSize = Math.min(MAX_QUESTIONS_PER_CALL, questionCount - collected.length);
    const batch = await extractExistingQuestionsBatch({
      apiKey,
      files,
      theoryContext,
      questionCount: batchSize,
      usedQuestions: collected,
      signal,
    });

    if (batch.length === 0) break;
    collected.push(...batch);
    const deduped = dedupeQuestions(collected);
    collected.length = 0;
    collected.push(...deduped);

    if (batch.length < batchSize) break;
  }

  return collected.slice(0, questionCount);
}

function getGenerationTopics(contentChunks) {
  const theoryChunks = contentChunks.filter((chunk) => chunk.kind === 'theory' || chunk.kind === 'mixed');
  const sourceChunks = theoryChunks.length ? theoryChunks : contentChunks;
  const topics = [...new Set(sourceChunks.map((chunk) => chunk.topic).filter(Boolean))];
  return topics.length ? topics : ['Geral'];
}

function selectFocusChunks(contentChunks, focusTopic, questionMode) {
  const mainChunks = contentChunks
    .filter((chunk) => (
      chunk.topic === focusTopic
      && (chunk.kind === 'theory' || chunk.kind === 'mixed' || questionMode === 'generated_only')
    ))
    .slice(0, 6);
  const fallbackChunks = contentChunks
    .filter((chunk) => chunk.kind === 'theory' || chunk.kind === 'mixed')
    .slice(0, 4);
  const styleChunks = questionMode === 'generated_only'
    ? contentChunks.filter((chunk) => chunk.kind === 'question_bank' || chunk.kind === 'mixed').slice(0, 4)
    : [];

  return dedupeChunks([...mainChunks, ...fallbackChunks, ...styleChunks]);
}

function dedupeChunks(chunks) {
  const seen = new Set();
  return chunks.filter((chunk) => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    return true;
  });
}

async function generateSupplementalQuestionsBatch({ apiKey, files, contentChunks, usedQuestions, questionCount, questionMode, focusTopic, signal }) {
  if (questionCount <= 0) return [];

  const generatedOnly = questionMode === 'generated_only';
  const selectedChunks = selectFocusChunks(contentChunks, focusTopic, questionMode);
  const theoryContext = selectedChunks.length
    ? buildChunkContext(selectedChunks, generatedOnly ? 'CONTEUDO/FORMATO' : 'CONTEUDO')
    : buildTheoryContext(files, { includeQuestionBanksAsStyle: generatedOnly });
  const existingTopics = usedQuestions
    .map((question) => question.topic || question.stem.slice(0, 120))
    .filter(Boolean)
    .join('\n- ');
  const skipList = buildSkipList(usedQuestions);

  const payload = await callDeepSeekJson({
    apiKey,
    signal,
    temperature: 0.35,
    system: `Voce e um professor de medicina criando questoes novas a partir de material teorico.

Regras:
- Use apenas informacoes presentes no material.
- Crie questoes no estilo prova, com 4 alternativas plausiveis.
- Uma unica alternativa correta.
- Foque em condutas, diagnostico, criterios, classificacoes, limiares e diferencas importantes.
- Evite repetir os temas das questoes ja extraidas.
- Nao gere questao parecida com enunciado ja usado, mesmo que mude nomes, idade, valores ou ordem das alternativas.
- Neste lote, priorize o foco tematico informado. Nao gere todas as questoes sobre o mesmo subtipo ou mesma conduta.
- Se houver bancos de questoes no material, use-os como referencia forte de FORMATO: tamanho do enunciado, nivel de dificuldade, estilo das alternativas, linguagem, tipo de distrator, distribuicao de temas e forma de explicacao.
- No modo "apenas questoes novas", voce deve gerar questoes ineditas no mesmo formato dos bancos enviados, mas sem copiar enunciados, alternativas ou casos clinicos especificos.
- Responda somente JSON valido.
- Nao use Markdown, comentarios, trailing commas nem texto antes/depois do JSON.`,
    user: `Gere ${questionCount} questoes novas para completar o simulado.

Formato obrigatorio:
{
  "questions": [
    {
      "id": "gen1",
      "stem": "Enunciado",
      "options": ["Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D"],
      "answerIndex": 0,
      "explanation": "Justificativa baseada no material teorico.",
      "topic": "Tema",
      "sourceFile": "Nome do PDF teorico",
      "sourcePage": "pagina se identificavel",
      "source": "Arquivo/pagina"
    }
  ]
}

## TEMAS JA COBERTOS POR QUESTOES EXTRAIDAS

- ${existingTopics || 'Nenhum'}

## QUESTOES JA USADAS OU CANDIDATAS PROIBIDAS

${skipList || 'Nenhuma.'}

## FOCO DESTE LOTE

${focusTopic}

## INSTRUCAO DE FORMATO

${generatedOnly
  ? 'Os PDFs classificados como banco de questoes devem ser usados como modelo de formato. Gere questoes novas que parecam pertencer ao mesmo banco, mantendo estilo, extensao, dificuldade e estrutura das alternativas, mas sem copiar conteudo literal.'
  : 'Complete o simulado com questoes novas sem repetir temas ja extraidos.'}

## MATERIAL TEORICO

${theoryContext}`,
  });

  return normalizeQuestions(payload, 'generated').slice(0, questionCount);
}

async function generateSupplementalQuestions({ apiKey, files, contentChunks, usedQuestions, questionCount, questionMode, signal }) {
  const collected = [];
  const topics = getGenerationTopics(contentChunks);
  let batchIndex = 0;

  while (collected.length < questionCount) {
    const batchSize = Math.min(MAX_QUESTIONS_PER_CALL, questionCount - collected.length);
    const focusTopic = topics[batchIndex % topics.length];
    const batch = await generateSupplementalQuestionsBatch({
      apiKey,
      files,
      contentChunks,
      usedQuestions: [...usedQuestions, ...collected],
      questionCount: batchSize,
      questionMode,
      focusTopic,
      signal,
    });

    if (batch.length === 0) break;
    collected.push(...batch);
    const deduped = dedupeQuestions(collected);
    collected.length = 0;
    collected.push(...deduped);

    if (batch.length < batchSize) break;
    batchIndex += 1;
  }

  return collected.slice(0, questionCount);
}

function buildAuditQuestionPayload(questions) {
  return questions.map((question) => ({
    id: question.id,
    stem: question.stem,
    options: question.options,
    answerIndex: question.answerIndex,
    explanation: question.explanation,
    topic: question.topic,
    source: question.source,
    origin: question.origin,
  }));
}

async function auditQuestionBatch({ apiKey, questions, signal }) {
  const payload = await callDeepSeekJson({
    apiKey,
    signal,
    temperature: 0.05,
    maxTokens: 4096,
    system: `Voce e um auditor de qualidade de questoes objetivas medicas.

Avalie cada questao por qualidade docimologica.

Aprove somente se:
- O enunciado e claro e tem informacao suficiente.
- Existe exatamente uma alternativa correta.
- As alternativas erradas sao plausiveis, mas inequivocamente erradas.
- Nao ha duas respostas defensaveis.
- Nao ha erro clinico evidente.
- A explicacao justifica a resposta.
- A questao nao depende de conhecimento ausente do enunciado/material indicado.
- A questao nao e repeticao obvia de outra questao do lote.

Seja seletivo:
- Score 90-100: questao excelente, clinicamente precisa, sem ressalvas.
- Score 78-89: questao boa, aproveitavel.
- Score 60-77: questao mediana, so use se faltar alternativa melhor.
- Abaixo de 60: questao ruim.

Reprove questoes ambiguas, com alternativa correta ausente, com duas corretas, repetidas, muito vagas, muito decorativas ou baseadas em dado numerico incerto.
Responda somente JSON valido.`,
    user: `Audite estas questoes e retorne JSON:

{
  "items": [
    {
      "id": "id-da-questao",
      "approved": true,
      "score": 0-100,
      "issue": "motivo curto se reprovada ou ressalva",
      "topic": "tema refinado"
    }
  ]
}

## QUESTOES

${JSON.stringify(buildAuditQuestionPayload(questions))}`,
  });

  return normalizeAuditItems(payload);
}

function getQuestionTopic(question) {
  return cleanText(question.topic) || inferTopic(`${question.stem}\n${question.explanation}`, question.sourceFile);
}

function getTopicLimit(questions, questionCount) {
  const topicCount = new Set(questions.map(getQuestionTopic).filter(Boolean)).size || 1;
  const balancedTopicCount = Math.min(topicCount, 6);
  return Math.max(2, Math.ceil(questionCount / balancedTopicCount) + 1);
}

function getTopicDistribution(questions) {
  return questions.reduce((distribution, question) => {
    const topic = getQuestionTopic(question);
    distribution[topic] = (distribution[topic] || 0) + 1;
    return distribution;
  }, {});
}

function selectBalancedQuestions(ranked, questionCount, questionMode) {
  const selected = [];
  const selectedIds = new Set();
  const topicCounts = new Map();
  const maxPerTopic = getTopicLimit(ranked, questionCount);
  const approved = ranked.filter((question) => question.audit?.approved && question.qualityScore >= MIN_AUDIT_SCORE);
  const primaryPool = approved.length >= Math.ceil(questionCount * 0.65) ? approved : ranked;
  const preferExtracted = questionMode === 'mixed';
  const extractedTarget = preferExtracted
    ? Math.min(Math.ceil(questionCount * 0.4), primaryPool.filter((question) => question.origin === 'extracted').length)
    : 0;

  function tryAdd(question, { enforceTopicLimit = true, threshold = FINAL_SIMILARITY_THRESHOLD } = {}) {
    if (selected.length >= questionCount || selectedIds.has(question.id)) return false;

    const topic = getQuestionTopic(question);
    const currentTopicCount = topicCounts.get(topic) || 0;
    if (enforceTopicLimit && currentTopicCount >= maxPerTopic) return false;

    if (selected.some((existing) => areSimilarQuestions(existing, question, threshold))) return false;

    selected.push({
      ...question,
      topic,
    });
    selectedIds.add(question.id);
    topicCounts.set(topic, currentTopicCount + 1);
    return true;
  }

  if (extractedTarget > 0) {
    for (const question of primaryPool.filter((item) => item.origin === 'extracted')) {
      tryAdd(question);
      if (selected.filter((item) => item.origin === 'extracted').length >= extractedTarget) break;
    }
  }

  for (const question of primaryPool) {
    tryAdd(question);
  }

  for (const question of ranked) {
    tryAdd(question, { threshold: RELAXED_SIMILARITY_THRESHOLD });
  }

  for (const question of ranked) {
    tryAdd(question, { enforceTopicLimit: false, threshold: RELAXED_SIMILARITY_THRESHOLD });
  }

  return selected.slice(0, questionCount);
}

async function auditAndRankQuestions({ apiKey, questions, questionCount, questionMode, signal }) {
  const deduped = dedupeQuestions(questions).map((question, index) => ({
    ...question,
    id: `${question.origin}-candidate-${index + 1}`,
  }));
  const auditItems = [];

  for (let index = 0; index < deduped.length; index += AUDIT_BATCH_SIZE) {
    const batch = deduped.slice(index, index + AUDIT_BATCH_SIZE);
    const result = await auditQuestionBatch({ apiKey, questions: batch, signal });
    auditItems.push(...result);
  }

  const auditById = new Map(auditItems.map((item) => [item.id, item]));
  const ranked = deduped
    .map((question) => {
      const audit = auditById.get(question.id);
      return {
        ...question,
        audit,
        topic: audit?.topic || question.topic,
        qualityScore: audit?.score ?? 0,
      };
    })
    .sort((a, b) => {
      const approvedDiff = Number(Boolean(b.audit?.approved)) - Number(Boolean(a.audit?.approved));
      if (approvedDiff) return approvedDiff;
      return (b.qualityScore || 0) - (a.qualityScore || 0);
    });

  const approved = ranked.filter((question) => question.audit?.approved && question.qualityScore >= MIN_AUDIT_SCORE);
  const selected = selectBalancedQuestions(ranked, questionCount, questionMode)
    .map((question, index) => ({
      ...question,
      id: `${question.origin}-${index + 1}`,
    }));

  return {
    questions: selected,
    auditSummary: {
      candidates: deduped.length,
      audited: auditItems.length,
      approved: approved.length,
      delivered: selected.length,
      topicDistribution: getTopicDistribution(selected),
    },
  };
}

export async function buildQuizFromCorpus({ apiKey, files, questionMode = 'generated_only', questionCount = 12, signal }) {
  const normalizedFiles = normalizeCorpusFiles(files);
  const classifiedFiles = classifyQuizFiles(normalizedFiles);
  const contentChunks = buildContentIndex(classifiedFiles);
  const theoryContext = buildTheoryContext(classifiedFiles);
  const shouldExtractQuestions = questionMode === 'mixed';
  const targetCandidateCount = Math.ceil(questionCount * 1.45);
  const extractedTarget = shouldExtractQuestions ? Math.ceil(targetCandidateCount * 0.7) : 0;
  const extractedQuestions = shouldExtractQuestions
    ? await extractExistingQuestions({
        apiKey,
        files: classifiedFiles,
        theoryContext,
        questionCount: extractedTarget,
        signal,
      })
    : [];

  const remainingCount = Math.max(0, targetCandidateCount - extractedQuestions.length);
  const generatedQuestions = await generateSupplementalQuestions({
    apiKey,
    files: classifiedFiles,
    contentChunks,
    usedQuestions: extractedQuestions,
    questionCount: remainingCount,
    questionMode,
    signal,
  });

  const rankedResult = await auditAndRankQuestions({
    apiKey,
    questions: [...extractedQuestions, ...generatedQuestions],
    questionCount,
    questionMode,
    signal,
  });
  const questions = rankedResult.questions;
  if (questions.length === 0) {
    throw new Error('Nao foi possivel extrair ou gerar questoes validas com esses PDFs.');
  }

  return {
    classifiedFiles,
    contentIndex: {
      chunkCount: contentChunks.length,
      topics: [...new Set(contentChunks.map((chunk) => chunk.topic).filter(Boolean))],
    },
    questionMode,
    auditSummary: rankedResult.auditSummary,
    extractedQuestions,
    generatedQuestions,
    questions,
  };
}
