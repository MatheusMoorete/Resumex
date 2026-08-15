import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mapTwoAtATime, pageContext, readVisualPage } from '../../summaryJobs.js';

const runFile = promisify(execFile);
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'py' : 'python3');
const WORKER_PATH = path.resolve('worker/process_pdf.py');

export type StudyFile = { name: string; path: string; size: number; uploaded?: boolean };
export type StudyCorpusFile = {
  name: string;
  size: number;
  numPages: number;
  pageTexts: string[];
  text: string;
  readMode: 'text';
  requiresVision: false;
};
export type StudyVisualQuestion = {
  id: string;
  page: number;
  sourceName: string;
  text: string;
  reason: string;
};
export type StudyVisualAnswer = {
  id: string;
  action: 'ignore' | 'use' | 'correct';
  value?: string;
};

export async function extractPdfPages({
  files,
  outputDir,
  signal,
  maxVisionPages,
  onProgress,
}: {
  files: StudyFile[];
  outputDir: string;
  signal?: AbortSignal;
  maxVisionPages: number;
  onProgress?: (stage: 'files' | 'vision', message: string, progress: number) => void;
}): Promise<any[]> {
  onProgress?.('files', 'Extraindo texto e detectando páginas visuais.', 15);
  const { stdout } = await runFile(PYTHON_BIN, [
    WORKER_PATH,
    ...files.map((file) => file.path),
    '--output-dir',
    outputDir,
    '--vision-mode',
    'auto',
    '--max-vision-pages',
    String(maxVisionPages),
  ], {
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    signal,
    timeout: 10 * 60 * 1000,
  });
  const parsed = JSON.parse(stdout);
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  if (!pages.length) throw new Error('O PDF não possui páginas legíveis.');

  const visionPages = pages.filter((page: any) => page.needsVision);
  if (visionPages.length > maxVisionPages) {
    throw new Error(`O material exige leitura visual de ${visionPages.length} páginas; o limite é ${maxVisionPages}. Divida o PDF.`);
  }
  if (visionPages.length) {
    onProgress?.('vision', `Lendo automaticamente ${visionPages.length} páginas visuais.`, 30);
    const results = await mapTwoAtATime(visionPages, (page) => readVisualPage(page, signal));
    visionPages.forEach((page: any, index: number) => { page.visual = results[index].result; });
  }
  return pages;
}

export function buildPdfCorpusFiles(files: StudyFile[], pages: any[]): StudyCorpusFile[] {
  return files.map((file, sourceIndex) => {
    const sourcePages = pages
      .filter((page) => page.sourceIndex === sourceIndex)
      .map((page) => ({ ...page, sourceName: file.name }));
    const pageTexts = sourcePages.map(pageContext);
    return {
      name: file.name,
      size: file.size,
      numPages: sourcePages.length,
      pageTexts,
      text: pageTexts.map((text, index) => `--- Página ${index + 1} ---\n${text}`).join('\n\n'),
      readMode: 'text',
      requiresVision: false,
    };
  });
}

export function buildTextCorpusFile(source: { name: string; text: string }): StudyCorpusFile {
  return {
    name: source.name,
    size: Buffer.byteLength(source.text, 'utf8'),
    numPages: 1,
    pageTexts: [source.text],
    text: `--- Página 1 ---\n${source.text}`,
    readMode: 'text',
    requiresVision: false,
  };
}

export function getVisualQuestions(pages: any[]): StudyVisualQuestion[] {
  for (const page of pages) {
    if (page.visual && Number(page.visual.confidence) < 0.65 && !page.visual.uncertainties?.length) {
      page.visual.uncertainties = [{
        text: page.visual.handwriting || page.visual.visualContent || 'Leitura visual com baixa confiança.',
        reason: 'A leitura visual precisa de confirmação humana.',
      }];
    }
  }
  return pages.flatMap((page) => (page.visual?.uncertainties || []).map((item: any, index: number) => ({
    id: `p${page.page}-q${index + 1}`,
    page: page.page,
    sourceName: String(page.sourceName || 'Documento'),
    text: String(item.text || 'Trecho visual incerto.').slice(0, 240),
    reason: String(item.reason || 'A leitura precisa de confirmação.').slice(0, 240),
  })));
}

export function applyVisualAnswers(pages: any[], answers: StudyVisualAnswer[]): void {
  const decisions = new Map(answers.map((answer) => [answer.id, answer]));
  for (const page of pages) {
    if (!page.visual?.uncertainties?.length) continue;
    const accepted: string[] = [];
    page.visual.uncertainties.forEach((item: any, index: number) => {
      const answer = decisions.get(`p${page.page}-q${index + 1}`);
      if (answer?.action === 'use') accepted.push(String(item.text || '').trim());
      if (answer?.action === 'correct' && answer.value?.trim()) accepted.push(answer.value.trim());
    });
    page.visual.handwriting = accepted.join('\n');
    if (Number(page.visual.confidence) < 0.65) page.visual.visualContent = '';
    page.visual.uncertainties = [];
    page.visual.confidence = Math.max(Number(page.visual.confidence) || 0, 0.9);
  }
}
