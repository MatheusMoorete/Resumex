import { buildAuthHeaders } from '../../auth/services/authClient';

type Job = {
  id: string;
  status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';
  stage: string;
  progress: number;
  error?: string | null;
  summary?: string | null;
  metrics?: Record<string, number> | null;
};

async function responseJson(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `Erro HTTP ${response.status}.`);
  return body;
}

export async function runSummaryJob({ files, preferences, signal, onProgress }) {
  const authHeaders = await buildAuthHeaders();
  const created = await responseJson(await fetch('/api/summary/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    credentials: 'same-origin',
    body: JSON.stringify({
      files: files.map((file: File) => ({ name: file.name, size: file.size })),
      preferences,
    }),
    signal,
  })) as Job;

  for (let index = 0; index < files.length; index += 1) {
    const response = await fetch(`/api/summary/jobs/${created.id}/files/${index}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', ...authHeaders },
      credentials: 'same-origin',
      body: files[index],
      signal,
    });
    if (!response.ok) await responseJson(response);
    onProgress?.({ stage: 'uploading', progress: Math.round(((index + 1) / files.length) * 10) });
  }

  await responseJson(await fetch(`/api/summary/jobs/${created.id}/start`, {
    method: 'POST',
    headers: authHeaders,
    credentials: 'same-origin',
    signal,
  }));

  while (!signal?.aborted) {
    const job = await responseJson(await fetch(`/api/summary/jobs/${created.id}`, {
      headers: authHeaders,
      credentials: 'same-origin',
      signal,
    })) as Job;
    onProgress?.({ stage: job.stage, progress: job.progress });
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.error || 'Falha ao gerar o resumo.');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new DOMException('Aborted', 'AbortError');
}
