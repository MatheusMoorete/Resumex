import { buildAuthHeaders } from '../../auth/services/authClient';

export type QuizJob = {
  id: string;
  status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  message: string;
  progress: number;
  error?: string | null;
  questions: any[];
  analysis: any;
};

async function responseJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `Erro HTTP ${response.status}.`);
  return body;
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function prepareQuizJob({
  files,
  summarySource,
  options,
  signal,
  onProgress,
}: {
  files: File[];
  summarySource?: { name: string; text: string } | null;
  options: unknown;
  signal?: AbortSignal;
  onProgress?: (job: QuizJob) => void;
}): Promise<QuizJob> {
  const authHeaders = await buildAuthHeaders();
  const created = await responseJson(await fetch('/api/quiz/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    credentials: 'same-origin',
    body: JSON.stringify({
      files: files.map((file) => ({ name: file.name, size: file.size })),
      summarySource,
      options,
    }),
    signal,
  })) as QuizJob;
  onProgress?.(created);

  try {
    for (let index = 0; index < files.length; index += 1) {
      await responseJson(await fetch(`/api/quiz/jobs/${created.id}/files/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf', ...authHeaders },
        credentials: 'same-origin',
        body: files[index],
        signal,
      }));
      onProgress?.({
        ...created,
        progress: Math.round(((index + 1) / files.length) * 10),
        message: `Enviando arquivo ${index + 1} de ${files.length}.`,
      });
    }

    await responseJson(await fetch(`/api/quiz/jobs/${created.id}/start`, {
      method: 'POST',
      headers: authHeaders,
      credentials: 'same-origin',
      signal,
    }));

    while (!signal?.aborted) {
      const job = await responseJson(await fetch(`/api/quiz/jobs/${created.id}`, {
        headers: authHeaders,
        credentials: 'same-origin',
        signal,
      })) as QuizJob;
      onProgress?.(job);
      if (job.status === 'completed') return job;
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(job.error || (job.status === 'cancelled' ? 'Geração cancelada.' : 'Falha ao gerar o simulado.'));
      }
      await wait(2000, signal);
    }
    throw new DOMException('Aborted', 'AbortError');
  } catch (error) {
    await fetch(`/api/quiz/jobs/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders,
      credentials: 'same-origin',
    }).catch(() => {});
    throw error;
  }
}

export async function cancelQuizJob(id: string) {
  const authHeaders = await buildAuthHeaders();
  await responseJson(await fetch(`/api/quiz/jobs/${id}`, {
    method: 'DELETE',
    headers: authHeaders,
    credentials: 'same-origin',
  }));
}
