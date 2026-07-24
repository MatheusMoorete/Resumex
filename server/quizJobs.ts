import express, { Request, Response, Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rateLimit } from './src/middlewares/rateLimit.js';
import { providers, upstreamTimeoutMs } from './src/config/env.js';
import {
  ALL_AUDIT_ROLES,
  getConfiguredAuditors,
  logAiUsage,
  normalizeAiPayload,
  resolveAiRoute,
} from './src/routes/aiProxy.js';
import { mapTwoAtATime, pageContext, readVisualPage } from './summaryJobs.js';
import {
  buildQuizFromCorpus,
  setQuizServerAiCaller,
} from '../src/features/quiz/services/quizApi.js';

const runFile = promisify(execFile);
const router: Router = express.Router();
const jobs = new Map<string, QuizJob>();
let queue = Promise.resolve();

const MAX_FILES = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ACTIVE_JOBS_PER_USER = 1;
const MAX_VISION_PAGES = 30;
const MAX_CORPUS_CHARS = 500_000;
const MAX_REFERENCE_QUESTIONS = 45;
const MAX_TEXT_AI_CALLS = 30;
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py' : 'python3');
const WORKER_PATH = path.resolve('worker/process_pdf.py');
const startJobRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  name: 'quiz-job-start',
});
const aiCallsBySignal = new WeakMap<AbortSignal, number>();
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

function responseContent(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((item) => item?.text || '').join('').trim();
  return '';
}

async function callQuizAi({
  system,
  user,
  signal,
  role,
  maxTokens,
  temperature,
}: any): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (signal) {
    const calls = (aiCallsBySignal.get(signal) || 0) + 1;
    if (calls > MAX_TEXT_AI_CALLS) {
      throw new Error(`O simulado excedeu o limite interno de ${MAX_TEXT_AI_CALLS} chamadas de IA.`);
    }
    aiCallsBySignal.set(signal, calls);
  }
  const primaryRoute = resolveAiRoute(role);
  if (!primaryRoute) throw new Error(`Papel de IA inválido: ${role}.`);
  const routeCandidates = ALL_AUDIT_ROLES.has(role) ? getConfiguredAuditors(role) : [primaryRoute];
  if (!routeCandidates.length) throw new Error('A auditoria independente do simulado não está configurada.');

  const budgetByRole: Record<string, number> = {
    'quiz-extract': 7000,
    'quiz-generate': 7000,
    'quiz-audit': 5000,
    'quiz-audit-simple': 5000,
    'quiz-audit-critical': 6000,
  };
  let lastError: Error | null = null;

  for (const route of routeCandidates) {
    const provider = providers[route.providerName];
    if (!provider?.envKey) continue;
    const payload = normalizeAiPayload({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: Math.min(Number(maxTokens) || 8192, budgetByRole[role] || 6000),
      response_format: { type: 'json_object' },
      temperature,
    }, route, role);
    const startedAt = Date.now();
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), upstreamTimeoutMs);
    const abort = () => timeoutController.abort();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${provider.envKey}`,
        'Content-Type': 'application/json',
      };
      if (route.providerName === 'openrouter') {
        headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || 'https://resumex.app';
        headers['X-OpenRouter-Title'] = process.env.OPENROUTER_APP_TITLE || 'ResumeX';
      }
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: timeoutController.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message || `${route.providerName} respondeu ${response.status}.`);
      }
      const content = responseContent(result);
      if (!content) throw new Error(`${route.providerName} retornou conteúdo vazio.`);
      if (result?.choices?.[0]?.finish_reason === 'length') {
        throw new Error(`${route.providerName} atingiu o limite de saída.`);
      }
      logAiUsage({
        role,
        providerName: route.providerName,
        model: route.model,
        usage: result?.usage,
        finishReason: result?.choices?.[0]?.finish_reason || null,
        durationMs: Date.now() - startedAt,
      });
      return content;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error('Falha no provedor de IA.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  throw lastError || new Error('Nenhum provedor de IA está configurado para o simulado.');
}

setQuizServerAiCaller(callQuizAi);

function buildCorpusFiles(job: QuizJob, pages: any[]) {
  return job.files.map((file, sourceIndex) => {
    const sourcePages = pages
      .filter((page) => page.sourceIndex === sourceIndex)
      .map((page) => ({
        ...page,
        sourceName: file.name,
        visual: page.visual
          && page.visual.confidence >= 0.85
          && !page.visual.uncertainties?.length
          ? page.visual
          : null,
      }));
    return {
      name: file.name,
      size: file.size,
      numPages: sourcePages.length,
      pageTexts: sourcePages.map((page) => pageContext(page)),
      text: sourcePages
        .map((page) => `--- Página ${page.sourcePage} ---\n${pageContext(page)}`)
        .join('\n\n'),
      readMode: 'text',
      requiresVision: false,
    };
  });
}

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
    update(job, {
      status: 'processing',
      stage: 'files',
      message: 'Extraindo texto e detectando páginas visuais.',
      progress: 15,
    });
    const { stdout } = await runFile(PYTHON_BIN, [
      WORKER_PATH,
      ...job.files.map((file) => file.path),
      '--output-dir',
      job.dir,
      '--vision-mode',
      'auto',
      '--max-vision-pages',
      String(MAX_VISION_PAGES),
    ], {
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      signal: job.controller.signal,
      timeout: 10 * 60 * 1000,
    });
    const pdfData = JSON.parse(stdout);
    const pages = Array.isArray(pdfData.pages) ? pdfData.pages : [];
    const visionPages = pages.filter((page: any) => page.needsVision);
    if (visionPages.length > MAX_VISION_PAGES) {
      throw new Error(
        `O material exige leitura visual de ${visionPages.length} páginas; o limite por simulado é ${MAX_VISION_PAGES}. Divida os PDFs.`
      );
    }
    if (visionPages.length) {
      update(job, {
        stage: 'vision',
        message: `Lendo automaticamente ${visionPages.length} páginas visuais.`,
        progress: 30,
      });
      const results = await mapTwoAtATime(
        visionPages,
        (page) => readVisualPage(page, job.controller.signal)
      );
      visionPages.forEach((page: any, index: number) => {
        page.visual = results[index].result;
      });
    }

    const files = buildCorpusFiles(job, pages);
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
  if (!rawFiles.length || rawFiles.length > MAX_FILES) {
    res.status(400).json({ error: { message: `Selecione entre 1 e ${MAX_FILES} arquivos PDF.` } });
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
    message: 'Aguardando envio dos PDFs.',
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
