import { useEffect, useRef, useState } from 'react';
import { FileText, Sparkles, Upload, X } from 'lucide-react';
import FicharioPdfDropzone from '../../../shared/components/FicharioPdfDropzone';
import type { FlashcardDraft } from '../domain/flashcards';
import {
  cancelFlashcardJob,
  finalizeFlashcardJob,
  prepareFlashcardJob,
  type FlashcardJob,
  type FlashcardVisualAnswer,
} from '../services/flashcardJobApi';

export default function FlashcardGenerator({ onDrafts }: { onDrafts: (drafts: FlashcardDraft[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const activeJobRef = useRef('');
  const [sourceMode, setSourceMode] = useState<'text' | 'pdf'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState<10 | 20 | 30>(20);
  const [job, setJob] = useState<FlashcardJob | null>(null);
  const [answers, setAnswers] = useState<Record<string, FlashcardVisualAnswer>>({});
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (activeJobRef.current) void cancelFlashcardJob(activeJobRef.current).catch(() => {});
  }, []);

  const updateJob = (next: FlashcardJob) => {
    setJob(next);
    activeJobRef.current = ['completed', 'failed', 'cancelled'].includes(next.status) ? '' : next.id;
  };

  const handleFiles = (files: FileList) => {
    const selected = files[0];
    setError('');
    if (!selected || (selected.type && selected.type !== 'application/pdf') || !selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Selecione um arquivo PDF.');
      return;
    }
    if (selected.size > 50 * 1024 * 1024) {
      setError('O PDF não pode ultrapassar 50 MB.');
      return;
    }
    setFile(selected);
  };

  const cancel = async () => {
    controllerRef.current?.abort();
    const id = activeJobRef.current;
    activeJobRef.current = '';
    if (id) await cancelFlashcardJob(id).catch(() => {});
    setIsWorking(false);
    setJob(null);
    setAnswers({});
  };

  const generate = async () => {
    if ((sourceMode === 'text' && !text.trim()) || (sourceMode === 'pdf' && !file)) return;
    await cancel();
    setError('');
    setIsWorking(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await prepareFlashcardJob({
        file: sourceMode === 'pdf' ? file : null,
        textSource: sourceMode === 'text' ? { name: 'Resumo externo.md', text: text.trim() } : null,
        sourceType: sourceMode === 'pdf' ? 'pdf' : 'external_text',
        count,
        signal: controller.signal,
        onProgress: updateJob,
      });
      updateJob(result.job);
      if (result.job.status === 'completed') {
        onDrafts(result.drafts);
        setIsWorking(false);
      }
    } catch (generationError) {
      if (generationError instanceof DOMException && generationError.name === 'AbortError') return;
      setError(generationError instanceof Error ? generationError.message : 'Não foi possível gerar os flashcards.');
      setIsWorking(false);
    }
  };

  const finishReview = async () => {
    if (!job || job.status !== 'awaiting_review') return;
    const decisions = job.questions.map((question) => answers[question.id]).filter(Boolean);
    if (decisions.length !== job.questions.length || decisions.some((answer) => answer.action === 'correct' && !answer.value?.trim())) {
      setError('Revise todas as leituras antes de continuar.');
      return;
    }
    setError('');
    setIsWorking(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await finalizeFlashcardJob({
        id: job.id,
        answers: decisions,
        signal: controller.signal,
        onProgress: updateJob,
      });
      updateJob(result.job);
      onDrafts(result.drafts);
      setIsWorking(false);
      setAnswers({});
    } catch (reviewError) {
      if (reviewError instanceof DOMException && reviewError.name === 'AbortError') return;
      setError(reviewError instanceof Error ? reviewError.message : 'Não foi possível concluir a geração.');
      setIsWorking(false);
    }
  };

  return (
    <section className="flashcard-generator" aria-labelledby="flashcard-generator-title">
      <div className="flashcard-generator-heading">
        <div>
          <span>Gerar com IA</span>
          <h3 id="flashcard-generator-title">Transforme seu material em cartões</h3>
          <p>Use um resumo externo ou envie um PDF. Você revisa tudo antes de salvar.</p>
        </div>
        <Sparkles size={24} aria-hidden="true" />
      </div>

      <div className="flashcard-source-tabs" role="tablist" aria-label="Fonte dos flashcards">
        <button type="button" role="tab" aria-selected={sourceMode === 'text'} className={sourceMode === 'text' ? 'is-active' : ''} onClick={() => setSourceMode('text')}>
          <FileText size={16} /> Colar texto
        </button>
        <button type="button" role="tab" aria-selected={sourceMode === 'pdf'} className={sourceMode === 'pdf' ? 'is-active' : ''} onClick={() => setSourceMode('pdf')}>
          <Upload size={16} /> Enviar PDF
        </button>
      </div>

      {sourceMode === 'text' ? (
        <label className="flashcard-source-text">
          Resumo ou texto externo
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={7} maxLength={500000} placeholder="Cole aqui o material que será a única fonte factual dos cartões…" />
          <span>{text.length.toLocaleString('pt-BR')} / 500.000 caracteres</span>
        </label>
      ) : file ? (
        <div className="flashcard-selected-file">
          <FileText size={20} />
          <div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
          <button type="button" onClick={() => setFile(null)} aria-label="Remover PDF"><X size={17} /></button>
        </div>
      ) : (
        <FicharioPdfDropzone
          variant="quiz"
          inputRef={inputRef}
          title="Envie um PDF"
          description="Até 50 MB. Anotações de caneta serão detectadas automaticamente."
          actionLabel="Escolher PDF"
          ariaLabel="Selecionar PDF para gerar flashcards"
          onFilesSelected={handleFiles}
        />
      )}

      <div className="flashcard-generator-actions">
        <label>Quantidade
          <select value={count} onChange={(event) => setCount(Number(event.target.value) as 10 | 20 | 30)} disabled={isWorking}>
            <option value={10}>10 cartões</option>
            <option value={20}>20 cartões</option>
            <option value={30}>30 cartões</option>
          </select>
        </label>
        {isWorking && <button className="btn btn-secondary" type="button" onClick={cancel}>Cancelar</button>}
        <button className="btn btn-primary" type="button" onClick={generate} disabled={isWorking || (sourceMode === 'text' ? !text.trim() : !file)}>
          {isWorking ? 'Gerando…' : 'Gerar flashcards'}
        </button>
      </div>

      {job && job.status !== 'awaiting_review' && isWorking && (
        <div className="flashcard-job-progress" aria-live="polite">
          <span>{job.message}</span>
          <progress max={100} value={job.progress}>{job.progress}%</progress>
        </div>
      )}

      {job?.status === 'awaiting_review' && (
        <div className="flashcard-visual-review">
          <div><strong>Confirme {job.questions.length} {job.questions.length === 1 ? 'leitura visual' : 'leituras visuais'}</strong><span>Conteúdo incerto não será usado sem sua decisão.</span></div>
          {job.questions.map((question) => (
            <fieldset key={question.id}>
              <legend>{question.sourceName} · página {question.page}</legend>
              <p><strong>Leitura provável:</strong> {question.text}</p>
              <span>{question.reason}</span>
              <div className="flashcard-review-options">
                {(['use', 'ignore', 'correct'] as const).map((action) => (
                  <label key={action}>
                    <input type="radio" name={question.id} checked={answers[question.id]?.action === action} onChange={() => setAnswers((current) => ({ ...current, [question.id]: { id: question.id, action } }))} />
                    {action === 'use' ? 'Usar leitura' : action === 'ignore' ? 'Ignorar' : 'Corrigir'}
                  </label>
                ))}
              </div>
              {answers[question.id]?.action === 'correct' && (
                <textarea value={answers[question.id]?.value || ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: { id: question.id, action: 'correct', value: event.target.value } }))} rows={2} placeholder="Digite a leitura correta" />
              )}
            </fieldset>
          ))}
          <button className="btn btn-primary" type="button" onClick={finishReview}>Confirmar e gerar</button>
        </div>
      )}

      {error && <div className="upload-error" role="alert">{error}</div>}
    </section>
  );
}
