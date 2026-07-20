import { buildAuthHeaders } from '../../auth/services/authClient';

export type VisualQuestion = {
  id: string;
  page: number;
  section?: string;
  text: string;
  reason: string;
  bbox?: [number, number, number, number] | null;
};

type Job = {
  id: string;
  status: 'uploading' | 'queued' | 'processing' | 'awaiting_review' | 'completed' | 'failed';
  stage: string;
  progress: number;
  error?: string | null;
  summary?: string | null;
  spec?: string | null;
  questions?: VisualQuestion[];
};

type Progress = { stage: string; progress: number };
type ProgressCallback = (progress: Progress) => void;

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

async function pollJob(
  id: string,
  signal: AbortSignal | undefined,
  onProgress: ProgressCallback | undefined,
  done: (job: Job) => boolean
) {
  const authHeaders = await buildAuthHeaders();
  while (!signal?.aborted) {
    const job = await responseJson(await fetch(`/api/summary/jobs/${id}`, {
      headers: authHeaders,
      credentials: 'same-origin',
      signal,
    })) as Job;
    onProgress?.({ stage: job.stage, progress: job.progress });
    if (done(job)) return job;
    if (job.status === 'failed') throw new Error(job.error || 'Falha ao gerar o resumo.');
    await wait(2000, signal);
  }
  throw new DOMException('Aborted', 'AbortError');
}

export async function prepareSummaryJob({
  files,
  preferences,
  signal,
  onProgress,
}: {
  files: File[];
  preferences: unknown;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}) {
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

  return pollJob(
    created.id,
    signal,
    onProgress,
    (job: Job) => job.status === 'awaiting_review'
  );
}

export async function finalizeSummaryJob({
  jobId,
  spec,
  answers,
  signal,
  onProgress,
}: {
  jobId: string;
  spec: string;
  answers: Array<{ id: string; action: 'ignore' | 'use' | 'correct'; value: string }>;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}) {
  const authHeaders = await buildAuthHeaders();
  await responseJson(await fetch(`/api/summary/jobs/${jobId}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    credentials: 'same-origin',
    body: JSON.stringify({ spec, answers }),
    signal,
  }));

  const job = await pollJob(
    jobId,
    signal,
    onProgress,
    (currentJob: Job) => currentJob.status === 'completed'
      || (currentJob.status === 'awaiting_review' && Boolean(currentJob.error))
  );
  if (job.status !== 'completed') throw new Error(job.error || 'Falha ao gerar o resumo.');
  return job;
}
