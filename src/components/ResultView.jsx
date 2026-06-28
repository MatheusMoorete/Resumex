import { useState, useCallback } from 'react';
import MarkdownPreview from './MarkdownPreview';
import PdfSplitViewer from './PdfSplitViewer';
import { copyToClipboard, stripPageReferences } from '../utils/clipboard';

export default function ResultView({ pdfUrl, summary, missingPages = [], onRegenerateWithCoverage, onNewSummary }) {
  const [viewMode, setViewMode] = useState('split'); // 'preview' | 'raw' | 'split'
  const [showToast, setShowToast] = useState(false);
  const [activePage, setActivePage] = useState(null);
  const [activeSourceText, setActiveSourceText] = useState('');

  const handleCopy = async () => {
    const success = await copyToClipboard(stripPageReferences(summary));
    if (success) {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
    }
  };

  // Navigate PDF to a specific page
  const handlePageClick = useCallback((pageNumber, sourceText = '') => {
    setActivePage(pageNumber);
    setActiveSourceText(sourceText);

    // If not in split view, switch to it
    if (viewMode !== 'split') {
      setViewMode('split');
    }
  }, [viewMode]);

  return (
    <div className="result-section">
      {/* Toolbar */}
      <div className="result-toolbar">
        <div className="result-toolbar-left">
          <button className="btn btn-ghost" onClick={onNewSummary}>
            ← Novo Resumo
          </button>
          <div className="result-tab-group">
            <button
              className={`result-tab ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
            >
              📄 Split View
            </button>
            <button
              className={`result-tab ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              👁️ Preview
            </button>
            <button
              className={`result-tab ${viewMode === 'raw' ? 'active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              📝 Markdown
            </button>
          </div>
        </div>

        <div className="result-toolbar-right">
          {activePage && (
            <span className="active-page-indicator">
              📍 Página {activePage}
            </span>
          )}
          <button className="btn btn-primary" onClick={handleCopy} id="copy-button">
            📋 Copiar para o Notion
          </button>
        </div>
      </div>

      {/* Warning alert if pages are missing */}
      {missingPages && missingPages.length > 0 && (
        <div className="coverage-warning-bar animate-fade-in">
          <div className="coverage-warning-content">
            <span className="coverage-warning-icon">⚠️</span>
            <div className="coverage-warning-text">
              <strong>Alerta de Cobertura Global:</strong> O resumo gerado omitiu as seguintes páginas do PDF:{' '}
              <strong className="coverage-warning-pages">{missingPages.join(', ')}</strong>.
            </div>
          </div>
          <button 
            className="btn btn-warning btn-sm" 
            onClick={onRegenerateWithCoverage} 
            id="btn-re-coverage"
            style={{ 
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              color: '#0f172a',
              border: 'none',
              padding: '6px 12px',
              fontWeight: 600,
              fontSize: 'var(--font-size-xs)'
            }}
          >
            ⚡ Regerar com Reforço de Cobertura
          </button>
        </div>
      )}

      {/* Body */}
      <div className="result-body">
        {/* PDF Panel (shown in split mode) */}
        {viewMode === 'split' && (
          <div className="result-panel result-panel-pdf">
            <PdfSplitViewer
              pdfUrl={pdfUrl}
              activePage={activePage || 1}
              sourceText={activeSourceText}
            />
          </div>
        )}

        {/* Summary Panel */}
        <div className="result-panel result-panel-summary">
          {viewMode === 'raw' ? (
            <div className="markdown-raw">{stripPageReferences(summary)}</div>
          ) : (
            <MarkdownPreview content={summary} onPageClick={handlePageClick} />
          )}
        </div>
      </div>

      {/* Copy Toast */}
      {showToast && (
        <div className="copy-toast">
          ✓ Markdown copiado! Cole no Notion com Ctrl+V
        </div>
      )}
    </div>
  );
}
