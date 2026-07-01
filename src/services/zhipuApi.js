/**
 * Zhipu AI (GLM) API service with page vision transcription.
 * Calls the local Node API boundary. The server uses env keys when the client
 * does not send an Authorization header.
 */

import { buildVisionTranscriptionPrompt } from '../prompts/templates';
import { buildAuthHeaders } from './authClient';

const API_URL = '/api/zhipu/chat/completions';
const MODEL_NAME = 'glm-4.5v';
const TRANSCRIPTION_CONCURRENCY = 2;

/**
 * Transcribes specific PDF pages using Zhipu's GLM-4.5V model.
 *
 * @param {Object} params
 * @param {string} params.apiKey - Zhipu AI API key
 * @param {Object} params.pageImages - Object mapping pageNum (number) -> base64 image data URL
 * @param {number[]} params.pageNumbersToTranscribe - Array of page numbers to transcribe
 * @param {number} params.totalPages - Total number of pages in the original PDF
 * @param {(progress: {current: number, total: number}) => void} [params.onProgress] - Progress callback
 * @param {AbortSignal} [params.signal] - Optional abort signal
 * @returns {Promise<Object>} - Object mapping pageNum -> transcribed Markdown string
 */
export async function transcribePDFWithGLM({ apiKey, pageImages, pageNumbersToTranscribe, totalPages, onProgress, signal }) {
  const total = pageNumbersToTranscribe.length;
  const pdfTotalPages = totalPages || Math.max(...pageNumbersToTranscribe);
  let completed = 0;

  if (total === 0) return {};

  const transcriptionMap = {};
  let nextIndex = 0;

  async function transcribeNextPage() {
    while (nextIndex < pageNumbersToTranscribe.length) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const pageNum = pageNumbersToTranscribe[nextIndex];
      nextIndex += 1;
      const pageImage = pageImages[pageNum];

      if (!pageImage) {
        transcriptionMap[pageNum] = `[Aviso: Nenhuma imagem gerada para a Pagina ${pageNum}]`;
        completed += 1;
        if (onProgress) onProgress({ current: completed, total });
        continue;
      }

      try {
        transcriptionMap[pageNum] = await transcribeSinglePage({
          apiKey,
          pageImage,
          pageNum,
          totalPages: pdfTotalPages,
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        transcriptionMap[pageNum] = `[Aviso: Falha ao transcrever a Pagina ${pageNum}: ${err.message}]`;
      } finally {
        completed += 1;
        if (onProgress) onProgress({ current: completed, total });
      }
    }
  }

  const workerCount = Math.min(TRANSCRIPTION_CONCURRENCY, total);
  await Promise.all(Array.from({ length: workerCount }, () => transcribeNextPage()));

  return transcriptionMap;
}
async function transcribeSinglePage({ apiKey, pageImage, pageNum, totalPages, signal }) {
  const prompt = buildVisionTranscriptionPrompt(pageNum, totalPages);
  const headers = {
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en',
    ...await buildAuthHeaders(),
  };
  if (apiKey) {
    headers['X-Provider-Authorization'] = `Bearer ${apiKey}`;
  }

  const userContent = [
    {
      type: 'text',
      text: `Transcreva a Página ${pageNum}. Priorize especialmente anotações manuscritas/caneta, setas, caixas, relações visuais e textos pequenos. Não resuma. Copie literalmente comparadores e símbolos (> < ≥ ≤ = + -), unidades, fórmulas e números. Se um sinal estiver duvidoso, marque como [comparador incerto] em vez de escolher.`,
    },
    {
      type: 'image_url',
      image_url: {
        url: pageImage,
      },
    },
  ];

  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        {
          role: 'system',
          content: prompt,
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      stream: false,
      max_tokens: 4096,
      temperature: 0.05,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = errorBody;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error?.message || parsed.message || errorBody;
    } catch (e) {}
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return content ? content.trim() : '[⚠️ GLM retornou transcrição vazia]';
}

/**
 * Validates a Zhipu AI API key.
 */
export async function validateZhipuApiKey(apiKey) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US,en',
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
        model: MODEL_NAME,
        messages: [{ role: 'user', content: 'Olá' }],
        max_tokens: 5,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
