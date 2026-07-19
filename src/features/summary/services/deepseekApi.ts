import { buildAuthHeaders } from '../../auth/services/authClient';

/**
 * DeepSeek API service with streaming and multimodal (vision) support.
 * Calls the local Node API boundary. The server uses env keys when the client
 * does not send an Authorization header.
 */

const API_URL = '/api/deepseek/chat/completions';

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
export async function generateSummary({ apiKey, pdfText, systemPrompt, pageImages, onChunk, signal }: GenerateSummaryParams) {
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
      model: 'deepseek-chat',
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
      max_tokens: 8192,
      temperature: 0.3,
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
        if (content) {
          fullText += content;
          onChunk(content);
        }
      } catch {
        // Skip malformed chunks
      }
    }
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

    const response = await fetch(API_URL, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Olá' }],
        max_tokens: 5,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
