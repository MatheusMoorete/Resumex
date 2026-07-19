import { buildAuthHeaders } from '../../auth/services/authClient';

/**
 * DeepSeek API service with streaming and multimodal (vision) support.
 * Calls the local Node API boundary. The server uses env keys when the client
 * does not send an Authorization header.
 */

const API_URL = '/api/ai/chat/completions';
const DEEPSEEK_VALIDATION_URL = '/api/deepseek/chat/completions';

export type AiRole =
  | 'evidence'
  | 'spec'
  | 'spec-audit'
  | 'spec-audit-simple'
  | 'spec-audit-critical'
  | 'spec-correction'
  | 'summary'
  | 'summary-audit'
  | 'summary-audit-simple'
  | 'summary-audit-critical'
  | 'summary-repair'
  | 'flashcards';

type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type GenerateSummaryParams = {
  apiKey?: string;
  pdfText: string;
  systemPrompt: string;
  pageImages?: string[];
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
  role?: AiRole;
  maxTokens?: number;
  temperature?: number;
};

/**
 * Builds a multimodal user message with page images and optional text.
 * @param {string} textContent - Text instruction or extracted text
 * @param {string[]} [pageImages] - Array of base64 data URLs for each page
 * @returns {Array} - Content array for the message
 */
function buildMultimodalContent(textContent: string, pageImages?: string[]) {
  if (!pageImages || pageImages.length === 0) {
    // Text-only mode
    return textContent;
  }

  // Multimodal mode: interleave text labels with page images
  const content: MessageContent[] = [
    {
      type: 'text',
      text: textContent,
    },
  ];

  for (let i = 0; i < pageImages.length; i++) {
    content.push({
      type: 'text',
      text: `\n--- Página ${i + 1} ---`,
    });
    content.push({
      type: 'image_url',
      image_url: {
        url: pageImages[i],
      },
    });
  }

  return content;
}

/**
 * Generates a summary using the DeepSeek API with streaming.
 * Supports both text-only and multimodal (vision) modes.
 *
 * @param {Object} params
 * @param {string} params.apiKey - DeepSeek API key
 * @param {string} params.pdfText - Extracted text or user message
 * @param {string} params.systemPrompt - System prompt
 * @param {string[]} [params.pageImages] - Optional array of base64 image data URLs
 * @param {(chunk: string) => void} params.onChunk - Callback for each text chunk
 * @param {AbortSignal} [params.signal] - Optional abort signal
 * @returns {Promise<string>} - The full generated text
 */
export async function generateSummary({
  apiKey,
  pdfText,
  systemPrompt,
  pageImages,
  onChunk,
  signal,
  role = 'summary',
  maxTokens,
  temperature = 0.1,
}: GenerateSummaryParams) {
  const headers = {
    'Content-Type': 'application/json',
    ...await buildAuthHeaders(),
  };
  if (apiKey) {
    headers['X-Provider-Authorization'] = `Bearer ${apiKey}`;
  }

  const userContent = buildMultimodalContent(
    pageImages && pageImages.length > 0
      ? `Abaixo está o conteúdo do PDF médico. Cada página é mostrada como uma imagem (que inclui texto impresso, diagramas E anotações manuscritas do aluno feitas com caneta digital). Leia TUDO — tanto o conteúdo impresso quanto as anotações escritas à mão.\n\n${pdfText}`
      : pdfText,
    pageImages
  );

  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({
      role,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      stream: true,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      temperature,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error?.message || parsed.message || errorBody;
    } catch {
      errorMessage = errorBody;
    }

    if (response.status === 401) {
      throw new Error('Chave de API inválida. Verifique sua chave do DeepSeek e tente novamente.');
    }
    if (response.status === 429) {
      throw new Error('Limite de requisições excedido. Aguarde alguns instantes e tente novamente.');
    }
    throw new Error(`Erro na API (${response.status}): ${errorMessage}`);
  }

  // Parse the SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let finishReason = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');

    // Keep the last incomplete line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        finishReason = parsed.choices?.[0]?.finish_reason || finishReason;
        if (content) {
          fullText += content;
          onChunk(content);
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }

  const routedProvider = response.headers.get('X-AI-Provider') || 'desconhecido';
  const routedModel = response.headers.get('X-AI-Model') || 'desconhecido';
  const routedRole = response.headers.get('X-AI-Role') || role;

  if (finishReason === 'length') {
    throw new Error(
      `A etapa ${routedRole} atingiu o limite de tokens no modelo ${routedModel} `
      + `(${routedProvider}) e ficou incompleta. O sistema não publicará conteúdo truncado.`
    );
  }

  return fullText;
}

/**
 * Validates an API key by making a lightweight request.
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function validateApiKey(apiKey) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...await buildAuthHeaders(),
    };
    if (apiKey) {
      headers['X-Provider-Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(DEEPSEEK_VALIDATION_URL, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Olá' }],
        max_tokens: 5,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
