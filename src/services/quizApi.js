import { buildAuthHeaders } from './authClient';

const API_URL = '/api/deepseek/chat/completions';
const MAX_CONTEXT_CHARS = 70000;
const MAX_FILE_CHARS = 24000;

function extractJsonObject(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : source;
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('A IA nao retornou um JSON valido para o teste.');
  }

  return JSON.parse(jsonText.slice(start, end + 1));
}

function truncateText(text, maxChars) {
  const source = String(text || '');
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

export function classifyQuizFiles(files) {
  return files.map((file) => {
    const text = String(file.text || '').slice(0, 40000);
    const questionSignals = [
      countMatches(text, /quest(?:ao|ão|ões|oes)\s*\d+/gi) * 3,
      countMatches(text, /\b[A-E]\)\s+\S/g) * 2,
      countMatches(text, /\b[A-E][\.\-]\s+\S/g),
      countMatches(text, /gabarito|resposta correta|alternativa correta|coment[aá]rio|enunciado/gi) * 2,
    ].reduce((sum, value) => sum + value, 0);
    const theorySignals = [
      countMatches(text, /^#{1,3}\s+/gm) * 2,
      countMatches(text, /defini[cç][aã]o|etiologia|diagn[oó]stico|tratamento|conduta|classifica[cç][aã]o|fisiopatologia/gi),
      countMatches(text, /---\s*p[aá]gina\s+\d+/gi),
    ].reduce((sum, value) => sum + value, 0);

    let kind = 'theory';
    if (questionSignals >= 12 && questionSignals >= theorySignals) {
      kind = 'question_bank';
    } else if (questionSignals >= 8 && theorySignals >= 6) {
      kind = 'mixed';
    }

    return {
      ...file,
      kind,
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
      stem: String(question.stem || '').trim(),
      options: Array.isArray(question.options)
        ? question.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 5)
        : [],
      answerIndex: Number(question.answerIndex),
      explanation: String(question.explanation || '').trim(),
      topic: String(question.topic || '').trim(),
      source: String(question.source || '').trim(),
      sourceFile: String(question.sourceFile || '').trim(),
      sourcePage: question.sourcePage ? String(question.sourcePage).trim() : '',
    }))
    .filter((question) => (
      question.stem
      && question.options.length >= 2
      && Number.isInteger(question.answerIndex)
      && question.answerIndex >= 0
      && question.answerIndex < question.options.length
    ));
}

async function extractExistingQuestions({ apiKey, files, theoryContext, questionCount, signal }) {
  const questionBankContext = buildQuestionBankContext(files);
  if (!questionBankContext.trim()) return [];

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
- Responda somente JSON valido.`,
    user: `Extraia ate ${questionCount} questoes existentes dos bancos abaixo.

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

async function generateSupplementalQuestions({ apiKey, files, usedQuestions, questionCount, questionMode, signal }) {
  if (questionCount <= 0) return [];

  const generatedOnly = questionMode === 'generated_only';
  const theoryContext = buildTheoryContext(files, { includeQuestionBanksAsStyle: generatedOnly });
  const existingTopics = usedQuestions
    .map((question) => question.topic || question.stem.slice(0, 120))
    .filter(Boolean)
    .join('\n- ');

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
- Se houver bancos de questoes no material, use-os apenas como referencia de estilo/tema/dificuldade; nao copie enunciados.
- Responda somente JSON valido.`,
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

## MATERIAL TEORICO

${theoryContext}`,
  });

  return normalizeQuestions(payload, 'generated').slice(0, questionCount);
}

export async function buildQuizFromCorpus({ apiKey, files, questionMode = 'generated_only', questionCount = 12, signal }) {
  const classifiedFiles = classifyQuizFiles(files);
  const theoryContext = buildTheoryContext(classifiedFiles);
  const shouldExtractQuestions = questionMode === 'mixed';
  const extractedQuestions = shouldExtractQuestions
    ? await extractExistingQuestions({
        apiKey,
        files: classifiedFiles,
        theoryContext,
        questionCount: Math.ceil(questionCount * 0.7),
        signal,
      })
    : [];

  const remainingCount = Math.max(0, questionCount - extractedQuestions.length);
  const generatedQuestions = await generateSupplementalQuestions({
    apiKey,
    files: classifiedFiles,
    usedQuestions: extractedQuestions,
    questionCount: remainingCount,
    questionMode,
    signal,
  });

  const questions = [...extractedQuestions, ...generatedQuestions].slice(0, questionCount);
  if (questions.length === 0) {
    throw new Error('Nao foi possivel extrair ou gerar questoes validas com esses PDFs.');
  }

  return {
    classifiedFiles,
    questionMode,
    extractedQuestions,
    generatedQuestions,
    questions,
  };
}
