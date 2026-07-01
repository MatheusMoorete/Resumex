import { buildAuthHeaders } from './authClient';

const API_URL = '/api/deepseek/chat/completions';

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

function normalizeQuestions(payload) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];

  return questions
    .map((question, index) => ({
      id: question.id || `q${index + 1}`,
      stem: String(question.stem || '').trim(),
      options: Array.isArray(question.options)
        ? question.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 5)
        : [],
      answerIndex: Number(question.answerIndex),
      explanation: String(question.explanation || '').trim(),
      source: String(question.source || '').trim(),
    }))
    .filter((question) => (
      question.stem
      && question.options.length >= 2
      && Number.isInteger(question.answerIndex)
      && question.answerIndex >= 0
      && question.answerIndex < question.options.length
    ))
    .slice(0, 15);
}

export async function generateQuizQuestions({ apiKey, files, questionCount = 10, signal }) {
  const headers = {
    'Content-Type': 'application/json',
    ...await buildAuthHeaders(),
  };
  if (apiKey) {
    headers['X-Provider-Authorization'] = `Bearer ${apiKey}`;
  }

  const sourceContext = files.map((file, fileIndex) => (
    `# ARQUIVO ${fileIndex + 1}: ${file.name}\n\n${file.text}`
  )).join('\n\n---\n\n');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `Voce e um professor de medicina criando um teste objetivo a partir de PDFs fornecidos.

Regras:
- Use apenas informacoes presentes no contexto.
- Crie questoes clinicas e conceituais relevantes para prova.
- Nao cobre detalhes impossiveis de responder pelo material.
- Distribua as questoes entre os arquivos e topicos mais importantes.
- Cada questao deve ter 4 alternativas plausiveis.
- Apenas uma alternativa deve estar correta.
- A explicacao deve justificar a resposta e citar arquivo/pagina quando possivel.
- Responda somente JSON valido, sem Markdown.`,
        },
        {
          role: 'user',
          content: `Gere ${questionCount} questoes de multipla escolha no formato JSON abaixo:

{
  "questions": [
    {
      "id": "q1",
      "stem": "Enunciado da questao",
      "options": ["A", "B", "C", "D"],
      "answerIndex": 0,
      "explanation": "Explicacao curta baseada no material.",
      "source": "Arquivo X, p. Y"
    }
  ]
}

## CONTEXTO DOS PDFs

${sourceContext}`,
        },
      ],
      stream: false,
      max_tokens: 8192,
      temperature: 0.35,
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
  const parsed = extractJsonObject(content);
  const questions = normalizeQuestions(parsed);

  if (questions.length === 0) {
    throw new Error('A IA nao gerou questoes validas. Tente novamente com PDFs mais legiveis.');
  }

  return questions;
}
