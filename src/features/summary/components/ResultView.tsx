import { useState, useCallback } from 'react';
import MarkdownPreview from '../../../shared/components/MarkdownPreview';
import PdfSplitViewer from '../../pdf/components/PdfSplitViewer';
import { copyToClipboard, stripPageReferences } from '../../../shared/utils/clipboard';
import { exportSummaryToNotion } from '../../notion/services/notionApi';
import { resolveCorpusPage } from '../../pdf/services/pdfCorpus';

export default function ResultView({ fileData, pdfUrl, summary, summaryLog = '', missingPages = [], onRegenerateWithCoverage, onNewSummary, onCreateFlashcards }) {
  const hasPdf = Boolean(fileData?.files?.length || pdfUrl);
  const [viewMode, setViewMode] = useState(hasPdf ? 'split' : 'preview'); // 'preview' | 'raw' | 'split'
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isSendingToNotion, setIsSendingToNotion] = useState(false);
  const [isCreatingFlashcards, setIsCreatingFlashcards] = useState(false);
  const [activePage, setActivePage] = useState(null);
  const [activeSourceText, setActiveSourceText] = useState('');
  const activePdf = resolveCorpusPage(fileData || { pdfUrl }, activePage || 1);

  const showToastMessage = (message) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3500);
  };

  const handleCopy = async () => {
    const success = await copyToClipboard(stripPageReferences(summary));
    if (success) {
      showToastMessage('Markdown copiado. Cole no Notion com Ctrl+V.');
    }
  };

  const handleSendToNotion = async () => {
    setIsSendingToNotion(true);

    try {
      const result = await exportSummaryToNotion({
        markdown: stripPageReferences(summary),
        title: 'Resumo ResumeX',
      });

      showToastMessage('Resumo enviado ao Notion.');

      if (result?.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      showToastMessage(error.message || 'Nao foi possivel enviar para o Notion.');
    } finally {
      setIsSendingToNotion(false);
    }
  };

  const handleCreateFlashcards = async () => {
    setIsCreatingFlashcards(true);
    try {
      await onCreateFlashcards?.();
    } catch (error) {
      showToastMessage(error.message || 'Não foi possível criar os flashcards.');
    } finally {
      setIsCreatingFlashcards(false);
    }
  };

  const handlePageClick = useCallback((pageNumber, sourceText = '') => {
    setActivePage(pageNumber);
    setActiveSourceText(sourceText);

    if (hasPdf && viewMode !== 'split') {
      setViewMode('split');
    }
  }, [hasPdf, viewMode]);

  return (
    <div className="result-section">
      <div className="result-toolbar">
        <div className="result-toolbar-left">
          <div className="result-toolbar-heading">
            <span>RESUMO / FINALIZADO</span>
            <button className="btn btn-ghost" onClick={onNewSummary}>Novo resumo</button>
          </div>
          <div className="result-tab-group">
            {hasPdf && (
              <button
                className={`result-tab ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
              >
                PDF + resumo
              </button>
            )}
            <button
              className={`result-tab ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              Resumo
            </button>
            <button
              className={`result-tab ${viewMode === 'raw' ? 'active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              Markdown
            </button>
            {summaryLog && (
              <button
                className={`result-tab ${viewMode === 'log' ? 'active' : ''}`}
                onClick={() => setViewMode('log')}
              >
                Auditoria
              </button>
            )}
          </div>
        </div>

        <div className="result-toolbar-right">
          {activePage && (
            <span className="active-page-indicator">
              {activePdf.sourceName} · página {activePdf.pageNum}
            </span>
          )}
          <button
            className="btn btn-secondary"
            onClick={handleCreateFlashcards}
            disabled={isCreatingFlashcards}
          >
            {isCreatingFlashcards ? 'Criando flashcards…' : 'Criar flashcards'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleSendToNotion}
            disabled={isSendingToNotion}
            id="notion-button"
          >
            {isSendingToNotion ? 'Enviando...' : 'Enviar ao Notion'}
          </button>
          <button className="btn btn-primary" onClick={handleCopy} id="copy-button">
            Copiar para o Notion
          </button>
        </div>
      </div>

      {missingPages && missingPages.length > 0 && (
        <div className="coverage-warning-bar animate-fade-in">
          <div className="coverage-warning-content">
            <span className="coverage-warning-icon">!</span>
            <div className="coverage-warning-text">
              <strong>Alerta de Cobertura Global:</strong> O resumo gerado omitiu as seguintes paginas do PDF:{' '}
              <strong className="coverage-warning-pages">{missingPages.join(', ')}</strong>.
            </div>
          </div>
          <button
            className="btn btn-warning btn-sm"
            onClick={onRegenerateWithCoverage}
            id="btn-re-coverage"
          >
            Regerar com reforço de cobertura
          </button>
        </div>
      )}

      <div className={`result-body is-${viewMode}`}>
        {viewMode === 'split' && activePdf.pdfUrl && (
          <div className="result-panel result-panel-pdf">
            <PdfSplitViewer
              pdfUrl={activePdf.pdfUrl}
              activePage={activePdf.pageNum}
              sourceText={activeSourceText}
            />
          </div>
        )}

        <div className="result-panel result-panel-summary">
          {viewMode === 'log' ? (
            <div className="result-log-panel">
              <div className="result-log-header">
                <span>Log de qualidade</span>
                <p>Esta seção é operacional e não será enviada ao Notion nem copiada como resumo.</p>
              </div>
              <MarkdownPreview content={summaryLog} />
            </div>
          ) : viewMode === 'raw' ? (
            <div className="markdown-raw">{stripPageReferences(summary)}</div>
          ) : (
            <MarkdownPreview content={summary} onPageClick={handlePageClick} />
          )}
        </div>
      </div>

      {showToast && (
        <div className="copy-toast">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
