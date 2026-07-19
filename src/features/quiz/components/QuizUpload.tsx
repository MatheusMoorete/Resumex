import { useCallback, useEffect, useRef, useState } from 'react';
import { extractTextFromPDF, formatFileSize } from '../../pdf/services/pdfExtractor';
import FicharioPanelHeader from '../../../shared/components/FicharioPanelHeader';
import FicharioPdfDropzone from '../../../shared/components/FicharioPdfDropzone';

const MAX_FILES = 5;
const MIN_TEXT_CHARS_FOR_TEXT_MODE = 300;

function getTextLength(text) {
  return String(text || '')
    .replace(/---[^\n]*---/g, '')
    .trim()
    .length;
}

function getInitialReadMode(extracted) {
  const textLength = getTextLength(extracted.text);
  return textLength < MIN_TEXT_CHARS_FOR_TEXT_MODE ? 'visual' : 'text';
}

export default function QuizUpload({
  deepseekAvailable,
  deepseekKey,
  zhipuAvailable,
  zhipuKey,
  initialFiles = [],
  onOpenApiKeyModal,
  onGenerate,
}) {
  const [files, setFiles] = useState(initialFiles);
  const [questionMode, setQuestionMode] = useState('generated_only');
  const [questionCount, setQuestionCount] = useState(15);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hasDeepseekAccess = deepseekAvailable ?? !!deepseekKey;
  const hasZhipuAccess = zhipuAvailable ?? !!zhipuKey;

  useEffect(() => {
    setFiles(initialFiles || []);
  }, [initialFiles]);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const selectedFiles = Array.from(fileList || []) as File[];
    if (selectedFiles.length === 0) return;

    if (selectedFiles.length > MAX_FILES) {
      setError(`Envie no maximo ${MAX_FILES} PDFs.`);
      return;
    }

    const invalid = selectedFiles.find((file) => file.type !== 'application/pdf');
    if (invalid) {
      setError('Todos os arquivos precisam ser PDFs.');
      return;
    }

    setError('');
    setIsProcessing(true);

    try {
      const processed = [];
      for (let index = 0; index < selectedFiles.length; index++) {
        const file = selectedFiles[index];
        setProgress(`Lendo ${index + 1} de ${selectedFiles.length}: ${file.name}`);
        const extracted = await extractTextFromPDF(file);
        const textLength = getTextLength(extracted.text);
        const readMode = getInitialReadMode(extracted);

        processed.push({
          file,
          name: file.name,
          size: file.size,
          numPages: extracted.numPages,
          pageTexts: extracted.pageTexts,
          pageMetadata: extracted.pageMetadata,
          text: extracted.text,
          textLength,
          readMode,
          requiresVision: readMode === 'visual',
        });
      }
      setFiles(processed);
    } catch (err) {
      setError(err.message || 'Não foi possível ler os PDFs.');
    } finally {
      setProgress('');
      setIsProcessing(false);
    }
  }, []);

  const updateFileReadMode = useCallback((targetFile, readMode) => {
    setFiles((currentFiles) => currentFiles.map((file) => (
      file.name === targetFile.name && file.size === targetFile.size
        ? {
            ...file,
            readMode,
            requiresVision: readMode === 'visual',
          }
        : file
    )));
  }, []);

  const handleSubmit = () => {
    if (!hasDeepseekAccess) {
      onOpenApiKeyModal();
      return;
    }

    const hasVisualFiles = files.some((file) => file.readMode === 'visual' || file.requiresVision);
    if (hasVisualFiles && !hasZhipuAccess) {
      onOpenApiKeyModal();
      return;
    }

    onGenerate(
      files.map((file) => ({
        ...file,
        requiresVision: file.readMode === 'visual' || file.requiresVision,
      })),
      { questionMode, questionCount }
    );
  };

  const hasVisualFiles = files.some((file) => file.readMode === 'visual' || file.requiresVision);
  const hasLowTextFiles = files.some((file) => file.textLength < MIN_TEXT_CHARS_FOR_TEXT_MODE);

  return (
    <div className="quiz-upload-section is-embedded">
      <div className="quiz-upload-shell">
        <FicharioPanelHeader
          kicker="NOVO SIMULADO"
          title="Adicione materiais para o simulado"
          description="Use até 5 PDFs. Arquivos escaneados podem ser configurados para leitura por imagem."
        />

        <FicharioPdfDropzone
          variant="quiz"
          inputRef={inputRef}
          title="Selecionar PDFs"
          description="Até 5 arquivos. Depois você informa quais precisam de leitura por imagem."
          ariaLabel="Selecionar até cinco arquivos PDF para o simulado"
          disabled={isProcessing}
          onFilesSelected={processFiles}
        />

        {isProcessing && (
          <div className="quiz-status">
            <div className="upload-progress-bar">
              <div className="upload-progress-fill" style={{ width: '66%' }} />
            </div>
            <span>{progress || 'Lendo PDFs...'}</span>
          </div>
        )}

        {error && <div className="upload-error">{error}</div>}

        {files.length > 0 && (
          <div className="quiz-file-list">
            {files.map((file) => (
              <div className="quiz-file-row" key={`${file.name}-${file.size}`}>
                <div className="quiz-file-main">
                  <strong>{file.name}</strong>
                  <span className="quiz-file-meta">
                    {file.numPages} páginas - {formatFileSize(file.size)} - {file.textLength} caracteres lidos
                  </span>
                  {file.textLength < MIN_TEXT_CHARS_FOR_TEXT_MODE && (
                    <span className="quiz-file-alert">Pouco texto detectado. Se for foto de prova, deixe em imagem/OCR.</span>
                  )}
                  {file.readMode === 'visual' && (
                    <span className="quiz-file-alert">Vai passar por leitura visual antes de gerar o teste.</span>
                  )}
                </div>
                <div className="quiz-file-mode" aria-label={`Tipo de leitura para ${file.name}`}>
                  <button
                    type="button"
                    className={file.readMode === 'text' ? 'selected' : ''}
                    onClick={() => updateFileReadMode(file, 'text')}
                  >
                    Texto
                  </button>
                  <button
                    type="button"
                    className={file.readMode === 'visual' ? 'selected' : ''}
                    onClick={() => updateFileReadMode(file, 'visual')}
                  >
                    Imagem/OCR
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasVisualFiles && (
          <div className="quiz-vision-warning">
            <strong>Leitura visual ativada</strong>
            <span>
              PDFs marcados como imagem/OCR serão convertidos em imagens e transcritos antes da análise. Isso demora mais e usa a API Zhipu/GLM visual.
            </span>
          </div>
        )}

        {hasLowTextFiles && !hasVisualFiles && (
          <div className="quiz-vision-warning">
            <strong>Arquivo com pouco texto</strong>
            <span>
              Se esse PDF for foto, selecione imagem/OCR. Caso contrário ele pode quase não contribuir para as questões.
            </span>
          </div>
        )}

        {files.length > 0 && (
          <section className="quiz-mode-panel">
            <div>
              <span className="quiz-kicker">Fonte das questões</span>
              <h2>Como montar o teste?</h2>
              <p>Use bancos de questões como inspiração ou misture questões reais extraídas dos arquivos.</p>
            </div>
            <div className="quiz-mode-options">
              <button
                type="button"
                className={questionMode === 'generated_only' ? 'selected' : ''}
                onClick={() => setQuestionMode('generated_only')}
              >
                <strong>Apenas questões novas</strong>
                <span>Arquivos com questões servem como modelo de estilo, tema e dificuldade.</span>
              </button>
              <button
                type="button"
                className={questionMode === 'mixed' ? 'selected' : ''}
                onClick={() => setQuestionMode('mixed')}
              >
                <strong>Misturar com questões dos PDFs</strong>
                <span>Extrai questões existentes dos arquivos e completa com questões novas.</span>
              </button>
            </div>
          </section>
        )}

        {files.length > 0 && (
          <section className="quiz-mode-panel">
            <div>
              <span className="quiz-kicker">Tamanho do simulado</span>
              <h2>Quantas questões?</h2>
              <p>Escolha a quantidade desejada. Simulados maiores podem demorar mais para gerar.</p>
            </div>
            <div className="quiz-count-options">
              {[15, 30, 45].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={questionCount === count ? 'selected' : ''}
                  onClick={() => setQuestionCount(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="quiz-upload-actions">
          {files.length > 0 && (
            <button className="btn btn-secondary" onClick={() => inputRef.current?.click()} disabled={isProcessing}>
              Trocar arquivos
            </button>
          )}
          <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={files.length === 0 || isProcessing}>
            Gerar teste
          </button>
        </div>
      </div>
    </div>
  );
}
