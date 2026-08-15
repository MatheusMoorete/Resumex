import { useState, useCallback } from 'react';
import MarkdownPreview from '../../../shared/components/MarkdownPreview';
import PdfSplitViewer from '../../pdf/components/PdfSplitViewer';
import { copyToClipboard, stripPageReferences } from '../../../shared/utils/clipboard';
import { exportSummaryToNotion } from '../../notion/services/notionApi';
import { resolveCorpusPage } from '../../pdf/services/pdfCorpus';

export default function ResultView({ fileData, pdfUrl, summary, onNewSummary, onGoToFichario, onCreateFlashcards, onCreateQuiz }) {
  const hasPdf = Boolean(fileData?.files?.length || pdfUrl);
  const [viewMode, setViewMode] = useState(hasPdf ? 'split' : 'preview');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isSendingToNotion, setIsSendingToNotion] = useState(false);
  const [isCreatingFlashcards, setIsCreatingFlashcards] = useState(false);
  const [isCreatingQuiz, setIsCreatingQuiz] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // 'flashcards' | 'quiz' | null
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

  const handleCreateQuiz = async () => {
    setIsCreatingQuiz(true);
    try {
      await onCreateQuiz?.();
    } catch (error) {
      showToastMessage(error.message || 'Não foi possível criar o simulado.');
    } finally {
      setIsCreatingQuiz(false);
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
            <button
              className="result-toolbar-back-btn"
              onClick={onGoToFichario || onNewSummary}
              title="Ir para o fichário de resumos"
            >
              Ir para resumos
            </button>
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
              className={`result-tab ${viewMode === 'notion' ? 'active' : ''}`}
              onClick={() => setViewMode('notion')}
            >
              Notion
            </button>
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
            onClick={() => setConfirmModal('flashcards')}
            disabled={isCreatingFlashcards}
          >
            {isCreatingFlashcards ? 'Criando flashcards…' : 'Criar flashcards'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setConfirmModal('quiz')}
            disabled={isCreatingQuiz}
          >
            {isCreatingQuiz ? 'Criando simulado…' : 'Criar simulado'}
          </button>
        </div>
      </div>

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
          {viewMode === 'notion' ? (
            <div className="notion-export-panel">
              <div className="notion-export-header">
                <span className="notion-export-badge">NOTION EXPORT</span>
                <h3 className="notion-export-title">Exportar para o Notion</h3>
                <p className="notion-export-desc">
                  Este resumo foi formatado em Markdown compatível com o Notion (toggles, callouts, tabelas e listas).
                  Clique no botão abaixo para copiar o resumo e cole diretamente em qualquer página do Notion (<kbd className="kbd-key">Ctrl</kbd> + <kbd className="kbd-key">V</kbd> / <kbd className="kbd-key">Cmd</kbd> + <kbd className="kbd-key">V</kbd>).
                </p>
                <div className="notion-export-actions">
                  <button className="btn btn-primary" onClick={handleCopy} id="copy-button">
                    Copiar para o Notion
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={handleSendToNotion}
                    disabled={isSendingToNotion}
                    id="notion-button"
                  >
                    {isSendingToNotion ? 'Enviando...' : 'Enviar ao Notion'}
                  </button>
                </div>
              </div>

              <div className="markdown-raw">{stripPageReferences(summary)}</div>
            </div>
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

      {confirmModal && (
        <div
          className="home-confirmation-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmModal(null);
          }}
        >
          <section
            className="home-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
          >
            {confirmModal === 'flashcards' ? (
              <>
                <span className="home-confirmation-kicker">CRIAR FLASHCARDS?</span>
                <h2 id="confirm-dialog-title">Gerar baralho de flashcards?</h2>
                <p>
                  Serão criados cartões de estudo e memorização ativa baseados nos tópicos e conceitos principais deste resumo para você praticar no seu fichário.
                </p>
                <div className="home-confirmation-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setConfirmModal(null)}
                  >
                    Continuar aqui
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setConfirmModal(null);
                      handleCreateFlashcards();
                    }}
                    disabled={isCreatingFlashcards}
                  >
                    {isCreatingFlashcards ? 'Criando…' : 'Gerar flashcards'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="home-confirmation-kicker">CRIAR SIMULADO?</span>
                <h2 id="confirm-dialog-title">Gerar simulado de questões?</h2>
                <p>
                  Será criado um teste objetivo com questões de múltipla escolha e gabarito comentado com base neste resumo.
                </p>
                <div className="home-confirmation-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setConfirmModal(null)}
                  >
                    Continuar aqui
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setConfirmModal(null);
                      handleCreateQuiz();
                    }}
                    disabled={isCreatingQuiz}
                  >
                    {isCreatingQuiz ? 'Criando…' : 'Gerar simulado'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
