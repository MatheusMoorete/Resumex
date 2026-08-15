import express, { Request, Response, Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rateLimit } from './src/middlewares/rateLimit.js';
import { callServerAi } from './src/services/serverAi.js';
import { buildPdfCorpusFiles, buildTextCorpusFile, extractPdfPages } from './src/services/studyCorpus.js';
import {
  buildQuizFromCorpus,
  setQuizServerAiCaller,
} from '../src/features/quiz/services/quizApi.js';

const router: Router = express.Router();
const jobs = new Map<string, QuizJob>();
let queue = Promise.resolve();

const MAX_FILES = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ACTIVE_JOBS_PER_USER = 1;
const MAX_VISION_PAGES = 30;
const MAX_CORPUS_CHARS = 500_000;
const MAX_SUMMARY_CHARS = 180_000;
const MAX_REFERENCE_QUESTIONS = 45;
const MAX_TEXT_AI_CALLS = 30;
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const startJobRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  name: 'quiz-job-start',
});
const createJobRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  name: 'quiz-job-create',
});

type QuizStatus = 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

interface QuizJob {
  id: string;
  userId: string;
  dir: string;
  status: QuizStatus;
  stage: string;
  message: string;
  progress: number;
  error: string | null;
  questions: any[];
  analysis: any;
  options: ReturnType<typeof normalizeQuizOptions>;
  files: Array<{ name: string; path: string; size: number; uploaded: boolean }>;
  summarySource: { name: string; text: string } | null;
  updatedAt: number;
  controller: AbortController;
}

function boundedText(value: any, max: number): string {
  return String(value || '').trim().slice(0, max);
}

function sanitizeQuestionReference(value: any) {
  return {
    id: boundedText(value?.id, 100),
    stem: boundedText(value?.stem, 800),
    options: Array.isArray(value?.options)
      ? value.options.slice(0, 4).map((option: any) => boundedText(option, 400))
      : [],
    answerIndex: Number.isInteger(value?.answerIndex) && value.answerIndex >= 0 && value.answerIndex <= 3
      ? value.answerIndex
      : 0,
    explanation: boundedText(value?.explanation, 1200),
    topic: boundedText(value?.topic, 160),
    sourceFile: boundedText(value?.sourceFile, 200),
    sourcePage: boundedText(value?.sourcePage, 40),
    evidenceQuote: boundedText(value?.evidenceQuote, 1200),
    origin: value?.origin === 'extracted' ? 'extracted' : 'generated',
  };
}

export function normalizeQuizOptions(input: any) {
  const questionCount = [15, 30, 45].includes(Number(input?.questionCount))
    ? Number(input.questionCount)
    : 15;
  const questionMode = input?.questionMode === 'mixed' ? 'mixed' : 'generated_only';
  const practiceMode = ['default', 'different', 'focused'].includes(input?.practiceMode)
    ? input.practiceMode
    : 'default';
  const previousQuestions = Array.isArray(input?.previousQuestions)
    ? input.previousQuestions.slice(0, MAX_REFERENCE_QUESTIONS).map(sanitizeQuestionReference)
    : [];
  const focusQuestions = practiceMode === 'focused' && Array.isArray(input?.focusQuestions)
    ? input.focusQuestions.slice(0, MAX_REFERENCE_QUESTIONS).map(sanitizeQuestionReference)
    : [];
  return { questionCount, questionMode, practiceMode, previousQuestions, focusQuestions };
}

export function normalizeQuizSummarySource(input: any) {
  const text = String(input?.text || '').trim();
  if (!text || text.length > MAX_SUMMARY_CHARS) return null;
  return {
    name: boundedText(input?.name, 200) || 'Resumo atual.md',
    text,
  };
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

function update(job: QuizJob, values: Partial<QuizJob>): void {
  Object.assign(job, values, { updatedAt: Date.now() });
}

function publicJob(job: QuizJob) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    error: job.error,
    questions: job.questions,
    analysis: job.analysis,
  };
}

function ownedJob(req: Request, res: Response): QuizJob | null {
  const job = jobs.get((req.params as any).id);
  if (!job || job.userId !== req.authUser?.id) {
    res.status(404).json({ error: { message: 'Job não encontrado.' } });
    return null;
  }
  return job;
}

setQuizServerAiCaller((params) => callServerAi({ ...params, maxCalls: MAX_TEXT_AI_CALLS }));

const STAGE_PROGRESS: Record<string, number> = {
  classify: 45,
  extract: 55,
  generate: 65,
  audit: 85,
  finish: 95,
};

async function runJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job || job.status === 'cancelled') return;

  try {
    let files;
    if (job.summarySource) {
      update(job, {
        status: 'processing',
        stage: 'classify',
        message: 'Preparando o resumo como fonte do simulado.',
        progress: 30,
      });
      files = [buildTextCorpusFile(job.summarySource)];
    } else {
      update(job, { status: 'processing' });
      const pages = await extractPdfPages({
        files: job.files,
        outputDir: job.dir,
        signal: job.controller.signal,
        maxVisionPages: MAX_VISION_PAGES,
        onProgress: (stage, message, progress) => update(job, { stage, message, progress }),
      });
      pages.forEach((page: any) => {
        if (page.visual && (page.visual.confidence < 0.85 || page.visual.uncertainties?.length)) page.visual = null;
      });
      files = buildPdfCorpusFiles(job.files, pages);
    }
    const corpusChars = files.reduce((total, file) => total + file.text.length, 0);
    if (corpusChars > MAX_CORPUS_CHARS) {
      throw new Error(
        `O texto extraído excede ${MAX_CORPUS_CHARS.toLocaleString('pt-BR')} caracteres. Divida o material em simulados menores.`
      );
    }

    const result = await buildQuizFromCorpus({
      apiKey: '',
      files,
      ...job.options,
      signal: job.controller.signal,
      onProgress: ({ stage, message }) => update(job, {
        stage,
        message,
        progress: STAGE_PROGRESS[stage] || job.progress,
      }),
    });
    const classifiedFiles = result.classifiedFiles.map((file: any) => ({
      name: file.name,
      size: file.size,
      numPages: file.numPages,
      kind: file.kind,
      textLength: file.textLength,
    }));
    update(job, {
      status: 'completed',
      stage: 'finish',
      message: 'Simulado pronto.',
      progress: 100,
      questions: result.questions,
      analysis: {
        classifiedFiles,
        contentIndex: result.contentIndex,
        questionMode: result.questionMode,
        practiceMode: result.practiceMode,
        orchestration: result.orchestration,
        auditSummary: result.auditSummary,
      },
    });
  } catch (error) {
    if (!job.controller.signal.aborted) {
      update(job, {
        status: 'failed',
        message: 'Falha ao gerar o simulado.',
        error: error instanceof Error ? error.message : 'Erro interno no simulado.',
      });
    }
  } finally {
    await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
}

router.post('/', createJobRateLimit, async (req: Request, res: Response) => {
  cleanOldJobs();
  const userId = req.authUser?.id;
  if (!userId) {
    res.status(401).json({ error: { message: 'Authentication required.' } });
    return;
  }
  const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
  const rawSummaryText = String(req.body?.summarySource?.text || '').trim();
  if (rawSummaryText.length > MAX_SUMMARY_CHARS) {
    res.status(400).json({ error: { message: `O resumo não pode ultrapassar ${MAX_SUMMARY_CHARS.toLocaleString('pt-BR')} caracteres.` } });
    return;
  }
  const summarySource = normalizeQuizSummarySource(req.body?.summarySource);
  if ((rawFiles.length > 0 && summarySource) || (!rawFiles.length && !summarySource) || rawFiles.length > MAX_FILES) {
    res.status(400).json({ error: { message: `Envie um resumo ou entre 1 e ${MAX_FILES} arquivos PDF.` } });
    return;
  }
  const activeJobs = Array.from(jobs.values()).filter(
    (job) => job.userId === userId && ['uploading', 'queued', 'processing'].includes(job.status)
  ).length;
  if (activeJobs >= MAX_ACTIVE_JOBS_PER_USER) {
    res.status(429).json({ error: { message: 'Aguarde ou cancele o simulado atual antes de iniciar outro.' } });
    return;
  }
  const invalidFile = rawFiles.find((file: any) => {
    const size = Number(file?.size || 0);
    return !Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES;
  });
  if (invalidFile) {
    res.status(400).json({ error: { message: 'Cada PDF deve ter entre 1 byte e 50 MB.' } });
    return;
  }
  const totalBytes = rawFiles.reduce((total: number, file: any) => total + Number(file.size), 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    res.status(400).json({ error: { message: 'O conjunto de PDFs não pode ultrapassar 100 MB.' } });
    return;
  }

  const id = randomUUID();
  const dir = path.join(os.tmpdir(), `resumex-quiz-${id}`);
  await fs.mkdir(dir, { recursive: true });
  const job: QuizJob = {
    id,
    userId,
    dir,
    status: 'uploading',
    stage: 'files',
    message: summarySource ? 'Resumo recebido.' : 'Aguardando envio dos PDFs.',
    progress: 0,
    error: null,
    questions: [],
    analysis: null,
    options: normalizeQuizOptions(req.body?.options),
    files: rawFiles.map((file: any, index: number) => ({
      name: boundedText(file?.name || `document-${index + 1}.pdf`, 200),
      size: Number(file.size),
      path: path.join(dir, `file-${index}.pdf`),
      uploaded: false,
    })),
    summarySource,
    updatedAt: Date.now(),
    controller: new AbortController(),
  };
  jobs.set(id, job);
  res.status(202).json(publicJob(job));
});

router.put('/:id/files/:index', express.raw({
  type: ['application/pdf', 'application/octet-stream', '*/*'],
  limit: '50mb',
}), async (req: Request, res: Response) => {
  const job = ownedJob(req, res);
  if (!job) return;
  if (job.status !== 'uploading') {
    res.status(400).json({ error: { message: 'Este job não aceita mais arquivos.' } });
    return;
  }
  const index = Number((req.params as any).index);
  if (!Number.isInteger(index) || index < 0 || index >= job.files.length) {
    res.status(400).json({ error: { message: 'Índice de arquivo inválido.' } });
    return;
  }
  const file = job.files[index];
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
  if (
    buffer.length !== file.size
    || buffer.length > MAX_FILE_BYTES
    || !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))
  ) {
    res.status(400).json({ error: { message: 'Arquivo PDF inválido ou tamanho diferente do declarado.' } });
    return;
  }
  await fs.writeFile(file.path, buffer);
  file.uploaded = true;
  update(job, { message: `Arquivo ${index + 1} de ${job.files.length} recebido.` });
  res.json({ ok: true });
});

router.post('/:id/start', startJobRateLimit, (req: Request, res: Response) => {
  const job = ownedJob(req, res);
  if (!job) return;
  if (job.status !== 'uploading' || job.files.some((file) => !file.uploaded)) {
    res.status(400).json({ error: { message: 'Envie todos os PDFs antes de iniciar o job.' } });
    return;
  }
  update(job, {
    status: 'queued',
    message: 'Simulado na fila de processamento.',
    progress: 5,
  });
  res.json(publicJob(job));
  queue = queue.then(() => runJob(job.id)).catch(() => {});
});

router.get('/:id', (req: Request, res: Response) => {
  cleanOldJobs();
  const job = ownedJob(req, res);
  if (!job) return;
  res.json(publicJob(job));
});

router.delete('/:id', async (req: Request, res: Response) => {
  const job = ownedJob(req, res);
  if (!job) return;
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    job.controller.abort();
    update(job, {
      status: 'cancelled',
      message: 'Geração cancelada.',
      error: null,
    });
  }
  await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  res.json(publicJob(job));
});

export default router;
