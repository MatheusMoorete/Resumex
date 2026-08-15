import express, { Request, Response, Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rateLimit } from './src/middlewares/rateLimit.js';
import {
  applyVisualAnswers,
  buildPdfCorpusFiles,
  buildTextCorpusFile,
  extractPdfPages,
  getVisualQuestions,
  type StudyVisualAnswer,
} from './src/services/studyCorpus.js';
import { generateGroundedFlashcards, type GeneratedFlashcardDraft } from './src/services/flashcardGeneration.js';

const router: Router = express.Router();
const jobs = new Map<string, FlashcardJob>();
let queue = Promise.resolve();

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;
const MAX_CORPUS_CHARS = 500_000;
const MAX_VISION_PAGES = 30;
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ACTIVE_JOBS_PER_USER = 1;
const createRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 6, name: 'flashcard-job-create' });
const startRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 6, name: 'flashcard-job-start' });

type SourceType = 'summary' | 'external_text' | 'pdf';
type Status = 'uploading' | 'queued' | 'processing' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';

interface FlashcardJob {
  id: string;
  userId: string;
  dir: string;
  status: Status;
  stage: string;
  message: string;
  progress: number;
  error: string | null;
  sourceType: SourceType;
  count: number;
  files: Array<{ name: string; path: string; size: number; uploaded: boolean }>;
  textSource: { name: string; text: string } | null;
  pages: any[];
  questions: ReturnType<typeof getVisualQuestions>;
  drafts: GeneratedFlashcardDraft[];
  updatedAt: number;
  controller: AbortController;
}

function bounded(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max);
}

export function normalizeFlashcardCount(value: unknown): number {
  return [10, 20, 30].includes(Number(value)) ? Number(value) : 20;
}

function publicJob(job: FlashcardJob) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    error: job.error,
    questions: job.questions,
    drafts: job.drafts,
  };
}

function update(job: FlashcardJob, values: Partial<FlashcardJob>): void {
  Object.assign(job, values, { updatedAt: Date.now() });
}

function ownedJob(req: Request, res: Response): FlashcardJob | null {
  const job = jobs.get((req.params as any).id);
  if (!job || job.userId !== req.authUser?.id) {
    res.status(404).json({ error: { message: 'Job não encontrado.' } });
    return null;
  }
  return job;
}

function cleanOldJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff && !['queued', 'processing'].includes(job.status)) {
      jobs.delete(id);
      void fs.rm(job.dir, { recursive: true, force: true });
    }
  }
}

function isComplexCorpus(pages: any[], text: string): boolean {
  const visualOrTable = pages.some((page) => (
    page.visual?.handwriting
    || page.visual?.visualContent
    || page.reasons?.some((reason: string) => /handwriting|table|diagram|arrow/i.test(reason))
  ));
  const criticalFacts = text.match(/\d+(?:[.,]\d+)?\s*(?:%|mg|mcg|µg|ml|mmhg|cm|mm)\b/gi)?.length || 0;
  return visualOrTable || criticalFacts >= 25;
}

async function generate(job: FlashcardJob): Promise<void> {
  try {
    update(job, { status: 'processing', stage: 'generate', message: 'Criando cartões com evidência verificável.', progress: 65 });
    const files = job.textSource
      ? [buildTextCorpusFile(job.textSource)]
      : buildPdfCorpusFiles(job.files, job.pages);
    const corpusChars = files.reduce((total, file) => total + file.text.length, 0);
    if (corpusChars > MAX_CORPUS_CHARS) {
      throw new Error(`O conteúdo excede ${MAX_CORPUS_CHARS.toLocaleString('pt-BR')} caracteres. Divida o material.`);
    }
    const corpusText = files.map((file) => file.text).join('\n\n');
    const drafts = await generateGroundedFlashcards({
      files,
      sourceType: job.sourceType,
      count: job.count,
      complex: isComplexCorpus(job.pages, corpusText),
      signal: job.controller.signal,
    });
    update(job, {
      status: 'completed',
      stage: 'finish',
      message: `${drafts.length} flashcards prontos para revisão.`,
      progress: 100,
      drafts,
      questions: [],
    });
  } catch (error) {
    if (!job.controller.signal.aborted) {
      update(job, {
        status: 'failed',
        stage: 'failed',
        message: 'Falha ao gerar flashcards.',
        error: error instanceof Error ? error.message : 'Erro interno na geração.',
      });
    }
  } finally {
    if (job.status !== 'awaiting_review') await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function run(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || job.status === 'cancelled') return;
  if (job.textSource) {
    await generate(job);
    return;
  }
  try {
    update(job, { status: 'processing' });
    job.pages = await extractPdfPages({
      files: job.files,
      outputDir: job.dir,
      signal: job.controller.signal,
      maxVisionPages: MAX_VISION_PAGES,
      onProgress: (stage, message, progress) => update(job, { stage, message, progress }),
    });
    job.questions = getVisualQuestions(job.pages);
    if (job.questions.length) {
      update(job, {
        status: 'awaiting_review',
        stage: 'review',
        message: 'Confirme as leituras visuais antes de criar os cartões.',
        progress: 50,
      });
      return;
    }
    await generate(job);
  } catch (error) {
    if (!job.controller.signal.aborted) {
      update(job, {
        status: 'failed',
        stage: 'failed',
        message: 'Falha ao preparar o PDF.',
        error: error instanceof Error ? error.message : 'Erro interno no processamento.',
      });
    }
    await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
}

router.post('/', createRateLimit, async (req: Request, res: Response) => {
  cleanOldJobs();
  const userId = req.authUser?.id;
  if (!userId) {
    res.status(401).json({ error: { message: 'Authentication required.' } });
    return;
  }
  const sourceType = ['summary', 'external_text', 'pdf'].includes(req.body?.sourceType)
    ? req.body.sourceType as SourceType
    : null;
  const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
  const rawText = String(req.body?.textSource?.text || '').trim();
  const hasPdf = sourceType === 'pdf' && rawFiles.length === 1 && !rawText;
  const hasText = sourceType !== 'pdf' && rawFiles.length === 0 && rawText.length > 0 && rawText.length <= MAX_TEXT_CHARS;
  if (!sourceType || (!hasPdf && !hasText)) {
    res.status(400).json({ error: { message: 'Envie um PDF ou um texto válido como fonte dos flashcards.' } });
    return;
  }
  if (hasPdf && (!Number.isFinite(Number(rawFiles[0]?.size)) || Number(rawFiles[0].size) <= 0 || Number(rawFiles[0].size) > MAX_FILE_BYTES)) {
    res.status(400).json({ error: { message: 'O PDF deve ter entre 1 byte e 50 MB.' } });
    return;
  }
  const active = Array.from(jobs.values()).some((job) => (
    job.userId === userId && ['uploading', 'queued', 'processing', 'awaiting_review'].includes(job.status)
  ));
  if (active) {
    res.status(429).json({ error: { message: 'Conclua ou cancele a geração atual antes de iniciar outra.' } });
    return;
  }

  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `resumex-flashcards-${id}`);
  await fs.mkdir(dir, { recursive: true });
  const job: FlashcardJob = {
    id,
    userId,
    dir,
    status: 'uploading',
    stage: 'files',
    message: hasText ? 'Texto recebido.' : 'Aguardando envio do PDF.',
    progress: 0,
    error: null,
    sourceType,
    count: normalizeFlashcardCount(req.body?.count),
    files: hasPdf ? [{
      name: bounded(rawFiles[0]?.name || 'documento.pdf', 200),
      path: path.join(dir, 'source.pdf'),
      size: Number(rawFiles[0].size),
      uploaded: false,
    }] : [],
    textSource: hasText ? {
      name: bounded(req.body?.textSource?.name, 200) || (sourceType === 'summary' ? 'Resumo atual.md' : 'Resumo externo.md'),
      text: rawText,
    } : null,
    pages: [],
    questions: [],
    drafts: [],
    updatedAt: Date.now(),
    controller: new AbortController(),
  };
  jobs.set(id, job);
  res.status(202).json(publicJob(job));
});

router.put('/:id/files/0', express.raw({ type: ['application/pdf', 'application/octet-stream', '*/*'], limit: '50mb' }), async (req: Request, res: Response) => {
  const job = ownedJob(req, res);
  if (!job) return;
  const file = job.files[0];
  if (job.status !== 'uploading' || !file) {
    res.status(400).json({ error: { message: 'Este job não aceita um PDF.' } });
    return;
  }
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
  if (buffer.length !== file.size || buffer.length > MAX_FILE_BYTES || !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    res.status(400).json({ error: { message: 'PDF inválido ou tamanho diferente do declarado.' } });
    return;
  }
  await fs.writeFile(file.path, buffer);
  file.uploaded = true;
  update(job, { message: 'PDF recebido.' });
  res.json({ ok: true });
});

router.post('/:id/start', startRateLimit, (req: Request, res: Response) => {
  const job = ownedJob(req, res);
  if (!job) return;
  if (job.status !== 'uploading' || job.files.some((file) => !file.uploaded)) {
    res.status(400).json({ error: { message: 'Envie a fonte antes de iniciar o job.' } });
    return;
  }
  update(job, { status: 'queued', message: 'Geração na fila.', progress: 5 });
  res.json(publicJob(job));
  queue = queue.then(() => run(job.id)).catch(() => {});
});

router.post('/:id/finalize', (req: Request, res: Response) => {
  const job = ownedJob(req, res);
  if (!job) return;
  if (job.status !== 'awaiting_review') {
    res.status(400).json({ error: { message: 'Este job não está aguardando revisão.' } });
    return;
  }
  const answers = Array.isArray(req.body?.answers) ? req.body.answers as StudyVisualAnswer[] : [];
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const valid = job.questions.every((question) => {
    const answer = byId.get(question.id);
    return answer && ['ignore', 'use', 'correct'].includes(answer.action)
      && (answer.action !== 'correct' || Boolean(answer.value?.trim()));
  });
  if (!valid) {
    res.status(400).json({ error: { message: 'Revise todas as leituras visuais antes de continuar.' } });
    return;
  }
  applyVisualAnswers(job.pages, answers);
  update(job, { status: 'queued', stage: 'generate', message: 'Revisões confirmadas.', progress: 55 });
  res.json(publicJob(job));
  queue = queue.then(() => generate(job)).catch(() => {});
});

router.get('/:id', (req: Request, res: Response) => {
  cleanOldJobs();
  const job = ownedJob(req, res);
  if (job) res.json(publicJob(job));
});

router.delete('/:id', async (req: Request, res: Response) => {
  const job = ownedJob(req, res);
  if (!job) return;
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    job.controller.abort();
    update(job, { status: 'cancelled', stage: 'cancelled', message: 'Geração cancelada.', error: null });
  }
  await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  res.json(publicJob(job));
});

export default router;
