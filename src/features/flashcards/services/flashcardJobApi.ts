import { buildAuthHeaders } from '../../auth/services/authClient';
import type { FlashcardDraft } from '../domain/flashcards';

const POLL_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export type FlashcardVisualQuestion = {
  id: string;
  page: number;
  sourceName: string;
  text: string;
  reason: string;
};

export type FlashcardJob = {
  id: string;
  status: 'uploading' | 'queued' | 'processing' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  message: string;
  progress: number;
  error?: string | null;
  questions: FlashcardVisualQuestion[];
  drafts: Array<{
    front: string;
    back: string;
    sourceType: FlashcardDraft['source_type'];
    sourceName: string;
    sourcePage: number | null;
    evidenceQuote: string;
  }>;
};

export type FlashcardVisualAnswer = {
  id: string;
  action: 'ignore' | 'use' | 'correct';
  value?: string;
};

async function responseJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `Erro HTTP ${response.status}.`);
  return body;
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function isRetryableFlashcardPollStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function mapDrafts(job: FlashcardJob): FlashcardDraft[] {
  return job.drafts.map((draft) => ({
    front: draft.front,
    back: draft.back,
    source_type: draft.sourceType,
    source_name: draft.sourceName,
    source_page: draft.sourcePage,
    evidence_quote: draft.evidenceQuote,
  }));
}

async function pollJob(id: string, signal?: AbortSignal, onProgress?: (job: FlashcardJob) => void) {
  const headers = await buildAuthHeaders();
  let consecutiveFailures = 0;
  while (!signal?.aborted) {
    let response: Response;
    try {
      response = await fetch(`/api/flashcard/jobs/${id}`, {
        headers,
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (signal?.aborted || consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw error;
      consecutiveFailures += 1;
      await wait(Math.min(POLL_INTERVAL_MS * consecutiveFailures, 10_000), signal);
      continue;
    }

    if (!response.ok && isRetryableFlashcardPollStatus(response.status)) {
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new Error('O servidor ficou temporariamente indisponível durante a geração. Tente novamente.');
      }
      consecutiveFailures += 1;
      await wait(Math.min(POLL_INTERVAL_MS * consecutiveFailures, 10_000), signal);
      continue;
    }

    const job = await responseJson(response) as FlashcardJob;
    consecutiveFailures = 0;
    onProgress?.(job);
    if (job.status === 'completed' || job.status === 'awaiting_review') return job;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(job.error || (job.status === 'cancelled' ? 'Geração cancelada.' : 'Falha ao gerar flashcards.'));
    }
    await wait(POLL_INTERVAL_MS, signal);
  }
  throw new DOMException('Aborted', 'AbortError');
}

export async function prepareFlashcardJob({
  file,
  textSource,
  sourceType,
  count,
  signal,
  onProgress,
}: {
  file?: File | null;
  textSource?: { name: string; text: string } | null;
  sourceType: 'summary' | 'external_text' | 'pdf';
  count: 10 | 20 | 30;
  signal?: AbortSignal;
  onProgress?: (job: FlashcardJob) => void;
}): Promise<{ job: FlashcardJob; drafts: FlashcardDraft[] }> {
  const headers = await buildAuthHeaders();
  const created = await responseJson(await fetch('/api/flashcard/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    credentials: 'same-origin',
    body: JSON.stringify({
      sourceType,
      count,
      files: file ? [{ name: file.name, size: file.size }] : [],
      textSource,
    }),
    signal,
  })) as FlashcardJob;

  try {
    if (file) {
      await responseJson(await fetch(`/api/flashcard/jobs/${created.id}/files/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf', ...headers },
        credentials: 'same-origin',
        body: file,
        signal,
      }));
    }
    await responseJson(await fetch(`/api/flashcard/jobs/${created.id}/start`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      signal,
    }));
    const job = await pollJob(created.id, signal, onProgress);
    return { job, drafts: mapDrafts(job) };
  } catch (error) {
    await cancelFlashcardJob(created.id).catch(() => {});
    throw error;
  }
}

export async function finalizeFlashcardJob({
  id,
  answers,
  signal,
  onProgress,
}: {
  id: string;
  answers: FlashcardVisualAnswer[];
  signal?: AbortSignal;
  onProgress?: (job: FlashcardJob) => void;
}): Promise<{ job: FlashcardJob; drafts: FlashcardDraft[] }> {
  const headers = await buildAuthHeaders();
  await responseJson(await fetch(`/api/flashcard/jobs/${id}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    credentials: 'same-origin',
    body: JSON.stringify({ answers }),
    signal,
  }));
  const job = await pollJob(id, signal, onProgress);
  return { job, drafts: mapDrafts(job) };
}

export async function cancelFlashcardJob(id: string) {
  const headers = await buildAuthHeaders();
  await responseJson(await fetch(`/api/flashcard/jobs/${id}`, {
    method: 'DELETE',
    headers,
    credentials: 'same-origin',
  }));
}
