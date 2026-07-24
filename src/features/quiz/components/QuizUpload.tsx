import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFileSize } from '../../pdf/services/pdfExtractor';
import FicharioPanelHeader from '../../../shared/components/FicharioPanelHeader';
import FicharioPdfDropzone from '../../../shared/components/FicharioPdfDropzone';

const MAX_FILES = 5;

function normalizeFile(file) {
  const source = file?.file instanceof File ? file.file : file;
  return source instanceof File
    ? { file: source, name: source.name, size: source.size }
    : null;
}

export default function QuizUpload({
  deepseekAvailable,
  initialFiles = [],
  onGenerate,
}) {
  const [files, setFiles] = useState(() => initialFiles.map(normalizeFile).filter(Boolean));
  const [questionMode, setQuestionMode] = useState('generated_only');
  const [questionCount, setQuestionCount] = useState(15);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hasDeepseekAccess = Boolean(deepseekAvailable);

  useEffect(() => {
    setFiles((initialFiles || []).map(normalizeFile).filter(Boolean));
  }, [initialFiles]);

  const processFiles = useCallback((fileList: FileList | File[]) => {
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
    setFiles(selectedFiles.map(normalizeFile).filter(Boolean));
  }, []);

  const handleSubmit = () => {
    if (!hasDeepseekAccess) {
      setError('O servidor precisa de uma chave DeepSeek para gerar simulados.');
      return;
    }

    onGenerate(files, { questionMode, questionCount });
  };

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
          description="Até 5 arquivos. A leitura visual necessária será detectada automaticamente."
          ariaLabel="Selecionar até cinco arquivos PDF para o simulado"
          disabled={false}
          onFilesSelected={processFiles}
        />

        {error && <div className="upload-error">{error}</div>}

        {files.length > 0 && (
          <div className="quiz-file-list">
            {files.map((file) => (
              <div className="quiz-file-row" key={`${file.name}-${file.size}`}>
                <div className="quiz-file-main">
                  <strong>{file.name}</strong>
                  <span className="quiz-file-meta">
                    {formatFileSize(file.size)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="quiz-vision-warning">
            <strong>Leitura visual automática</strong>
            <span>Somente páginas com pouco texto, imagens relevantes ou anotações serão enviadas para leitura visual.</span>
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
            <button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
              Trocar arquivos
            </button>
          )}
          <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={files.length === 0}>
            Gerar teste
          </button>
        </div>
      </div>
    </div>
  );
}
