import { useState, useRef, useCallback } from 'react';
import { extractTextFromPDF } from '../services/pdfExtractor';

export default function UploadZone({ onUploadComplete }) {
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

      const fileData = {
        file,
        name: file.name,
        size: file.size,
        numPages,
        text,
        pageTexts,
        pageMetadata,
        pdfUrl,
      };

      setIsProcessing(false);
      onUploadComplete(fileData);
    } catch (err) {
      console.error('Error processing PDF:', err);
      setError('Erro ao processar o PDF. Verifique se o arquivo não está corrompido.');
      setIsProcessing(false);
    }
  }, [onUploadComplete]);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    processFile(file);
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
    <div className="landing-section">
      <div className="landing-hero">
        <h1 className="landing-title">
          Transforme anotações em{' '}
          <span className="gradient-text">resumos inteligentes</span>
        </h1>
        <p className="landing-subtitle">
          Faça upload do seu material de estudo e receba um resumo estruturado, 
          100% fiel ao conteúdo original, pronto para colar no Notion.
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

        {error && <div className="upload-error">⚠️ {error}</div>}
      </div>
    </div>
  );
}
