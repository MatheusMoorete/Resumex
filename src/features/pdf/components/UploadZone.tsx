import { useCallback, useEffect, useRef, useState } from 'react';
import { extractTextFromPDF, formatFileSize } from '../services/pdfExtractor';
import { createPdfCorpus } from '../services/pdfCorpus';
import QuizUpload from '../../quiz/components/QuizUpload';
import FlashcardHome from '../../flashcards/components/FlashcardHome';
import FicharioPanelHeader from '../../../shared/components/FicharioPanelHeader';
import FicharioPdfDropzone from '../../../shared/components/FicharioPdfDropzone';
import StudyModeTabs, { type StudyMode } from '../../../shared/components/StudyModeTabs';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
type UploadZoneProps = {
  onUploadComplete: (corpus: any) => void;
  onStartLocalTest?: () => void;
  quizConfig?: any;
  flashcardConfig?: { initialDrafts?: any[] };
  initialMode?: StudyMode;
  onModeChange?: (mode: StudyMode) => void;
  onActivityChange?: (active: boolean) => void;
};

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export default function UploadZone({ onUploadComplete, onStartLocalTest, quizConfig, flashcardConfig, initialMode = 'summary', onModeChange, onActivityChange }: UploadZoneProps) {
  const [activeMode, setActiveMode] = useState<StudyMode>(initialMode);
  const [panelTransition, setPanelTransition] = useState(0);
  const [hasOpenedFlashcards, setHasOpenedFlashcards] = useState(initialMode === 'flashcards');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, fileName: '' });
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setActiveMode(initialMode);
    if (initialMode === 'flashcards') setHasOpenedFlashcards(true);
  }, [initialMode]);

  useEffect(() => {
    onActivityChange?.(activeMode !== 'summary' || selectedFiles.length > 0 || isProcessing);
  }, [activeMode, isProcessing, onActivityChange, selectedFiles.length]);

  useEffect(() => () => onActivityChange?.(false), [onActivityChange]);

  const selectMode = (mode: StudyMode) => {
    if (mode === activeMode) return;
    if (mode === 'flashcards') setHasOpenedFlashcards(true);
    setActiveMode(mode);
    onModeChange?.(mode);
    setPanelTransition((current) => current + 1);
  };

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const invalidType = incoming.find((file) => file.type !== 'application/pdf');
    if (invalidType) {
      setError(`${invalidType.name} não é um arquivo PDF.`);
      return;
    }

    const oversized = incoming.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) {
      setError(`${oversized.name} excede o limite de 50 MB.`);
      return;
    }

    setSelectedFiles((current) => {
      const known = new Set(current.map(fileKey));
      const uniqueIncoming = incoming.filter((file) => !known.has(fileKey(file)));
      const next = [...current, ...uniqueIncoming];

      if (next.length > MAX_FILES) {
        setError(`Você pode combinar no máximo ${MAX_FILES} PDFs por resumo.`);
        return current;
      }

      setError('');
      return next;
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeFile = useCallback((target: File) => {
    setSelectedFiles((current) => current.filter((file) => fileKey(file) !== fileKey(target)));
    setError('');
  }, []);

  const processFiles = useCallback(async () => {
    if (!selectedFiles.length) return;

    setError('');
    setIsProcessing(true);
    setProgress({ current: 0, total: selectedFiles.length, fileName: '' });
    const processedFiles = [];

    try {
      for (let index = 0; index < selectedFiles.length; index++) {
        const file = selectedFiles[index];
        setProgress({ current: index + 1, total: selectedFiles.length, fileName: file.name });
        const extracted = await extractTextFromPDF(file);

        processedFiles.push({
          file,
          name: file.name,
          size: file.size,
          numPages: extracted.numPages,
          text: extracted.text,
          pageTexts: extracted.pageTexts,
          pageMetadata: extracted.pageMetadata,
          pdfUrl: URL.createObjectURL(file),
        });
      }

      onUploadComplete(createPdfCorpus(processedFiles));
    } catch (processingError) {
      processedFiles.forEach((processedFile) => URL.revokeObjectURL(processedFile.pdfUrl));
      console.error('Error processing PDF corpus:', processingError);
      setError('Não foi possível ler um dos PDFs. Verifique se os arquivos não estão corrompidos.');
      setIsProcessing(false);
    }
  }, [onUploadComplete, selectedFiles]);

  const progressPercent = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const totalPagesLabel = selectedFiles.length === 1 ? '1 PDF selecionado' : `${selectedFiles.length} PDFs selecionados`;

  return (
    <main className={`workspace-home workspace-home-fichario mode-${activeMode}`}>
      <section className="workspace-shell" aria-labelledby="workspace-title">
        <header className="workspace-intro">
          <div>
            <p className="workspace-kicker">MODO FOCO: ON</p>
            <h1 id="workspace-title">
              Jogue o PDF <em>na mesa</em>
            </h1>
            <p>que a gente organiza para você</p>
          </div>
          <div className="workspace-limit">
            <span>Espaço na mesa</span>
            <strong>Até 5 PDFs</strong>
          </div>
        </header>

        <StudyModeTabs activeMode={activeMode} onSelect={selectMode} />

        <div className="study-mode-panel-stage">
          <div className={`study-mode-panel-content panel-refresh-${panelTransition % 2 ? 'b' : 'a'}`}>
          <section
            className="workspace-upload-panel"
            aria-labelledby="summary-upload-title"
            hidden={activeMode !== 'summary'}
          >
          <FicharioPanelHeader
            kicker="FICHA #001 / NOVO RESUMO"
            title="Coloque o material na prancheta"
            description="Cada página continua ligada ao PDF de origem."
            titleId="summary-upload-title"
            aside={<span className="file-capacity">{selectedFiles.length}/{MAX_FILES}</span>}
          />

          <FicharioPdfDropzone
              variant="summary"
              inputRef={fileInputRef}
              title={selectedFiles.length >= MAX_FILES ? 'Limite de arquivos atingido' : 'Arraste os PDFs ou clique para selecionar'}
              description="Até 5 arquivos · 50 MB por PDF · texto, imagens e manuscritos"
              actionLabel={selectedFiles.length ? 'Adicionar' : 'Escolher arquivos'}
              ariaLabel="Selecionar até cinco arquivos PDF"
              inputId="file-input"
              isDragOver={isDragOver}
              isFull={selectedFiles.length >= MAX_FILES}
              disabled={isProcessing}
              onFilesSelected={addFiles}
              onDragStateChange={setIsDragOver}
            />

          {selectedFiles.length > 0 && (
            <div className="summary-file-list" aria-live="polite">
              {selectedFiles.map((file, index) => (
                <div className="summary-file-row" key={fileKey(file)}>
                  <span className="summary-file-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="summary-file-info">
                    <strong>{file.name}</strong>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="summary-file-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFile(file);
                    }}
                    aria-label={`Remover ${file.name}`}
                    disabled={isProcessing}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          )}

          {isProcessing && (
            <div className="summary-processing" role="status" aria-live="polite">
              <div>
                <strong>Preparando materiais</strong>
                <span>{progress.current}/{progress.total} · {progress.fileName}</span>
              </div>
              <div className="summary-processing-track" aria-hidden="true">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}

          {error && <div className="upload-error" role="alert">{error}</div>}

          {onStartLocalTest && (
            <div className="local-test-entry">
              <div>
                <span>LOCALHOST / TESTE</span>
                <strong>Validar o fluxo sem selecionar um PDF</strong>
              </div>
              <button type="button" onClick={onStartLocalTest}>Usar material de teste →</button>
            </div>
          )}

          <div className="summary-workbench-actions">
            <span>{selectedFiles.length ? totalPagesLabel : 'Nenhum arquivo selecionado'}</span>
            <button
              className="btn btn-primary summary-start-button"
              type="button"
              onClick={processFiles}
              disabled={!selectedFiles.length || isProcessing}
            >
              {isProcessing ? 'Lendo materiais…' : 'Configurar resumo'}
            </button>
          </div>
          </section>

          <div hidden={activeMode !== 'quiz'}>
            {quizConfig && (
              <QuizUpload
                {...quizConfig}
              />
            )}
          </div>

          <div hidden={activeMode !== 'flashcards'}>
            {hasOpenedFlashcards && (
              <div className="flashcard-embedded-panel">
                <FlashcardHome
                  initialDrafts={flashcardConfig?.initialDrafts || []}
                />
              </div>
            )}
          </div>
          </div>
        </div>
      </section>
    </main>
  );
}
