import { useCallback, useRef, useState } from 'react';
import { extractTextFromPDF } from '../services/pdfExtractor';

export default function UploadZone({ onUploadComplete, onStartQuiz }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('Por favor, envie um arquivo PDF.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError('O arquivo excede o limite de 50MB.');
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      const { text, numPages, pageTexts, pageMetadata } = await extractTextFromPDF(file);
      const pdfUrl = URL.createObjectURL(file);

      setIsProcessing(false);
      onUploadComplete({
        file,
        name: file.name,
        size: file.size,
        numPages,
        text,
        pageTexts,
        pageMetadata,
        pdfUrl,
      });
    } catch (err) {
      console.error('Error processing PDF:', err);
      setError('Erro ao processar o PDF. Verifique se o arquivo não está corrompido.');
      setIsProcessing(false);
    }
  }, [onUploadComplete]);

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    processFile(event.dataTransfer.files[0]);
  };

  const handleFileSelect = (event) => {
    processFile(event.target.files[0]);
  };

  if (isProcessing) {
    return (
      <div className="landing-section">
        <div className="landing-hero">
          <div className="upload-icon">📎</div>
          <h2 style={{ fontSize: 'var(--font-size-xl)', marginBottom: 'var(--space-md)' }}>
            Processando seu PDF...
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Analisando páginas e extraindo texto...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-page">
      <section className="landing-section">
        <div className="landing-hero">
          <h1 className="landing-title">
            Transforme anotações em <span className="gradient-text">resumos inteligentes</span>
          </h1>
          <p className="landing-subtitle">
            Faça upload do seu material de estudo e receba um resumo estruturado,
            fiel ao conteúdo original, pronto para revisar e colar no Notion.
          </p>
        </div>

        <div className="upload-zone">
          <div
            className={`upload-dropzone ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            id="upload-dropzone"
          >
            <div className="upload-icon">📎</div>
            <p className="upload-text">
              Arraste seu PDF aqui ou <strong>clique para selecionar</strong>
            </p>
            <p className="upload-hint">PDF de até 50MB · Inclui suporte a anotações manuscritas</p>
            <input
              ref={fileInputRef}
              className="upload-input"
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileSelect}
              id="file-input"
            />
          </div>

          {error && <div className="upload-error">{error}</div>}
        </div>

        <div className="landing-mode-row">
          <button className="landing-mode-button" type="button" onClick={onStartQuiz}>
            <span>Teste MVP</span>
            <strong>Gerar questoes de ate 5 PDFs</strong>
          </button>
        </div>
      </section>

      <section className="how-section" aria-labelledby="how-title">
        <div className="how-header">
          <span className="how-kicker">Como funciona</span>
          <h2 id="how-title">Do PDF anotado ao resumo auditado.</h2>
          <p>
            O ResumeX combina extração de texto, leitura visual e auditoria para reduzir
            omissões e separar informações confirmadas de trechos incertos.
          </p>
        </div>

        <div className="how-steps">
          <article className="how-step">
            <span className="how-step-number">01</span>
            <h3>Leitura do material</h3>
            <p>
              O texto selecionável é extraído do PDF. Páginas com caneta, setas,
              esquemas ou baixa confiança podem ser enviadas para leitura visual.
            </p>
          </article>

          <article className="how-step">
            <span className="how-step-number">02</span>
            <h3>Mapa de evidências</h3>
            <p>
              Cada página é organizada por origem: texto confirmado, transcrição visual,
              manuscritos legíveis, trechos incertos e valores críticos.
            </p>
          </article>

          <article className="how-step">
            <span className="how-step-number">03</span>
            <h3>Plano auditado</h3>
            <p>
              A IA cria um plano de resumo, audita inconsistências e corrige o que
              conseguir automaticamente antes de mostrar para revisão.
            </p>
          </article>

          <article className="how-step">
            <span className="how-step-number">04</span>
            <h3>Resumo rastreável</h3>
            <p>
              O resumo final preserva citações por página, destaca riscos de
              transcrição e permite revisar o PDF lado a lado.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
