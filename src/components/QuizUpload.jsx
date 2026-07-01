import { useCallback, useRef, useState } from 'react';
import { extractTextFromPDF, formatFileSize } from '../services/pdfExtractor';

const MAX_FILES = 5;

export default function QuizUpload({ deepseekAvailable, deepseekKey, onOpenApiKeyModal, onGenerate, onBack }) {
  const [files, setFiles] = useState([]);
  const [questionMode, setQuestionMode] = useState('generated_only');
  const [questionCount, setQuestionCount] = useState(15);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const hasDeepseekAccess = deepseekAvailable ?? !!deepseekKey;

  const processFiles = useCallback(async (fileList) => {
    const selectedFiles = Array.from(fileList || []);
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
        processed.push({
          file,
          name: file.name,
          size: file.size,
          numPages: extracted.numPages,
          text: extracted.text,
        });
      }
      setFiles(processed);
    } catch (err) {
      setError(err.message || 'Nao foi possivel ler os PDFs.');
    } finally {
      setProgress('');
      setIsProcessing(false);
    }
  }, []);

  const handleSubmit = () => {
    if (!hasDeepseekAccess) {
      onOpenApiKeyModal();
      return;
    }
    onGenerate(files, { questionMode, questionCount });
  };

  return (
    <div className="quiz-upload-section">
      <div className="quiz-upload-shell">
        <div className="quiz-upload-header">
          <button className="btn btn-ghost" onClick={onBack}>Voltar</button>
          <span className="quiz-kicker">MVP de testes</span>
          <h1>Crie questoes a partir dos seus PDFs</h1>
          <p>Envie ate 5 arquivos. O Resumex le o texto selecionavel e gera um teste objetivo para resolver aqui mesmo.</p>
        </div>

        <div
          className="quiz-dropzone"
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
        >
          <div className="upload-icon">PDF</div>
          <strong>Selecionar PDFs</strong>
          <span>Ate 5 arquivos, usando leitura textual rapida.</span>
          <input
            ref={inputRef}
            className="upload-input"
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={(event) => processFiles(event.target.files)}
          />
        </div>

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
                <div>
                  <strong>{file.name}</strong>
                  <span>{file.numPages} paginas · {formatFileSize(file.size)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <section className="quiz-mode-panel">
            <div>
              <span className="quiz-kicker">Fonte das questoes</span>
              <h2>Como montar o teste?</h2>
              <p>Use bancos de questoes como inspiracao ou misture questoes reais extraidas dos arquivos.</p>
            </div>
            <div className="quiz-mode-options">
              <button
                type="button"
                className={questionMode === 'generated_only' ? 'selected' : ''}
                onClick={() => setQuestionMode('generated_only')}
              >
                <strong>Apenas questoes novas</strong>
                <span>Arquivos com questoes servem como modelo de estilo, tema e dificuldade.</span>
              </button>
              <button
                type="button"
                className={questionMode === 'mixed' ? 'selected' : ''}
                onClick={() => setQuestionMode('mixed')}
              >
                <strong>Misturar com questoes dos PDFs</strong>
                <span>Extrai questoes existentes dos arquivos e completa com questoes novas.</span>
              </button>
            </div>
          </section>
        )}

        {files.length > 0 && (
          <section className="quiz-mode-panel">
            <div>
              <span className="quiz-kicker">Tamanho do simulado</span>
              <h2>Quantas questoes?</h2>
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
          <button className="btn btn-secondary" onClick={() => inputRef.current?.click()} disabled={isProcessing}>
            Trocar arquivos
          </button>
          <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={files.length === 0 || isProcessing}>
            Gerar teste
          </button>
        </div>
      </div>
    </div>
  );
}
