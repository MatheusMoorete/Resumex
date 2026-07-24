import { useEffect, useRef, useState } from 'react';
import { formatFileSize } from '../../pdf/services/pdfExtractor';
import { resolveCorpusPage } from '../../pdf/services/pdfCorpus';
import MarkdownPreview from '../../../shared/components/MarkdownPreview';
import PdfSplitViewer from '../../pdf/components/PdfSplitViewer';
import PdfRegionPreview from './PdfRegionPreview';
import pdfIcon from '../../../assets/pdf_icon.png';

function isRiskDecisionResolved(decision) {
  if (!decision) return false;
  if (decision.action === 'correct') return Boolean(decision.value?.trim());
  return true;
}

const GENERATION_STAGES = [
  { id: 'evidence', label: 'Mapeando evidências', description: 'Relacionando os conceitos às páginas de origem e preservando o contexto do material.' },
  { id: 'structure', label: 'Montando a estrutura', description: 'Aplicando o método, os formatos e a profundidade escolhidos por você.' },
];

export default function SpecEditor({
  fileData,
  spec,
  highRiskItems = [],
  riskDecisions = {},
  isGenerating,
  generationStage = 'evidence',
  onSpecChange,
  onRiskDecisionChange,
  onGenerate,
  onBack,
  isVisualReview = false,
}) {
  const [viewMode, setViewMode] = useState(
    isVisualReview && highRiskItems.length > 0 ? 'risk' : 'preview'
  );
  const [pdfReviewItem, setPdfReviewItem] = useState(null);
  const textareaRef = useRef(null);
  const unresolvedRiskCount = highRiskItems.filter((item) => !isRiskDecisionResolved(riskDecisions[item.id])).length;
  const completedRiskCount = highRiskItems.length - unresolvedRiskCount;
  const generationStageIndex = Math.max(0, GENERATION_STAGES.findIndex((item) => item.id === generationStage));
  const currentGenerationStage = GENERATION_STAGES[generationStageIndex];
  const resolvedPdfReview = pdfReviewItem
    ? resolveCorpusPage(fileData, pdfReviewItem.page)
    : null;

  useEffect(() => {
    if (isGenerating) setViewMode('preview');
  }, [isGenerating]);

  useEffect(() => {
    if (isGenerating && viewMode === 'edit' && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [spec, isGenerating, viewMode]);

  useEffect(() => {
    if (!pdfReviewItem) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setPdfReviewItem(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pdfReviewItem]);

  const handlePrimaryAction = () => {
    if (unresolvedRiskCount > 0) {
      setViewMode('risk');
      return;
    }
    onGenerate();
  };

  return (
    <div className="spec-section">
      <div className="spec-file-bar">
        <div className="uploaded-file" style={{ flex: 1 }}>
          <img className="uploaded-file-icon" src={pdfIcon} alt="" aria-hidden="true" />
          <div className="uploaded-file-info">
            <div className="uploaded-file-name">{fileData.name}</div>
            <div className="uploaded-file-meta">
              {fileData.files?.length > 1 ? `${fileData.files.length} arquivos · ` : ''}
              {fileData.numPages} {fileData.numPages === 1 ? 'página' : 'páginas'} · {formatFileSize(fileData.size)}
            </div>
          </div>
        </div>
      </div>

      <div className="spec-header-bar">
        <div className="spec-header-left">
          <span className="spec-header-kicker">{isGenerating ? 'RESUMO / ANÁLISE' : 'RESUMO / REVISÃO'}</span>
          <h2>{isGenerating ? 'Analisando material' : 'Plano do resumo'}</h2>
          <p>
            {isGenerating
              ? 'Lendo o material e preparando a estrutura do plano.'
              : isVisualReview
                ? 'Confira o plano e responda apenas às dúvidas visuais antes de gerar o resumo.'
                : 'Confira a estrutura antes de gerar o resumo.'}
          </p>
        </div>

        {!isGenerating && (
          <div className="spec-view-tabs">
            <button
              className={`result-tab ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              Plano
            </button>
            <button
              className={`result-tab ${viewMode === 'risk' ? 'active' : ''}`}
              onClick={() => setViewMode('risk')}
            >
              Dúvidas do material{highRiskItems.length ? ` (${highRiskItems.length})` : ''}
            </button>
            <button
              className={`result-tab ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => setViewMode('edit')}
            >
              Editar
            </button>
          </div>
        )}
      </div>

      {!isGenerating && unresolvedRiskCount > 0 && viewMode !== 'risk' && (
        <button
          type="button"
          className="spec-review-alert"
          onClick={() => setViewMode('risk')}
        >
          <span>
            Encontramos {unresolvedRiskCount} {unresolvedRiskCount === 1 ? 'trecho visual que precisa' : 'trechos visuais que precisam'} da sua confirmação.
          </span>
          <strong>Revisar agora</strong>
        </button>
      )}

      <div className="spec-editor-container">
        {(viewMode === 'preview' || isGenerating) && (
          <div className={`spec-preview-wrapper ${isGenerating ? 'generating' : ''}`}>
            {isGenerating ? (
              <div className="spec-generation-layout">
                <aside className="spec-generation-status">
                  <span className="spec-generation-kicker">Preparando plano</span>
                  <h3>Transformando a leitura em um plano confiável</h3>
                  <p>
                    Cada etapa preserva a ligação com o PDF antes de entregar a estrutura para sua revisão.
                  </p>
                  <div className="spec-generation-current" role="status" aria-live="polite">
                    <span>AGORA</span>
                    <strong>{currentGenerationStage.label}</strong>
                    <p>{currentGenerationStage.description}</p>
                    <i aria-hidden="true"><b /><b /><b /></i>
                  </div>
                  <div className="spec-generation-steps" aria-label={`Etapa ${generationStageIndex + 1} de ${GENERATION_STAGES.length}`}>
                    {GENERATION_STAGES.map((item, index) => (
                      <div className={`spec-generation-step ${index < generationStageIndex ? 'done' : ''} ${index === generationStageIndex ? 'active' : ''}`} key={item.id}>
                        <span>{index < generationStageIndex ? '✓' : index + 1}</span>
                        <strong>{item.label}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="spec-generation-facts">
                    <div>
                      <span>Paginas</span>
                      <strong>{fileData.numPages}</strong>
                    </div>
                    <div>
                      <span>Arquivo</span>
                      <strong>{formatFileSize(fileData.size)}</strong>
                    </div>
                  </div>
                </aside>
                <div className="spec-generation-preview">
                  <div className="spec-generation-preview-header">
                    <span>PLANO EM CONSTRUÇÃO</span>
                    <strong>{spec ? 'A estrutura aparece enquanto é preparada' : 'Aguardando o mapa de evidências'}</strong>
                  </div>
                  {spec ? (
                    <MarkdownPreview content={spec} />
                  ) : (
                    <div className="spec-skeleton">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="spec-preview-content" id="spec-preview">
                {spec ? (
                  <MarkdownPreview content={spec} />
                ) : (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-3xl)' }}>
                    Nenhum plano gerado ainda.
                  </div>
                )}
              </div>
            )}
            {isGenerating && (
              <div className="spec-generating-indicator">
                <span className="spec-generating-dot" />
                <span>Etapa {generationStageIndex + 1} de {GENERATION_STAGES.length} · {currentGenerationStage.label}</span>
              </div>
            )}
          </div>
        )}

        {viewMode === 'edit' && !isGenerating && (
          <div className="spec-editor-wrapper">
            <div className="spec-edit-helper">
              Edite o plano que será usado para gerar o resumo.
            </div>
            <textarea
              ref={textareaRef}
              className="spec-textarea"
              value={spec}
              onChange={(event) => onSpecChange(event.target.value)}
              placeholder="O plano do resumo aparecera aqui..."
              spellCheck={false}
              id="spec-editor"
            />
          </div>
        )}

        {viewMode === 'risk' && !isGenerating && (
          <div className="spec-risk-panel">
            <div className="spec-risk-header">
              <h3>Dúvidas encontradas no material</h3>
              <p>
                Responda com um clique. Se precisar conferir melhor, amplie o trecho no PDF. {completedRiskCount} de {highRiskItems.length} revisadas.
              </p>
            </div>

            {highRiskItems.length === 0 ? (
              <div className="spec-risk-empty">
                Nenhum trecho visual precisa da sua confirmação.
              </div>
            ) : (
              <div className="spec-risk-list">
                {highRiskItems.map((item) => {
                  const decision = riskDecisions[item.id];
                  const resolved = isRiskDecisionResolved(decision);
                  const source = resolveCorpusPage(fileData, item.page);
                  return (
                    <div className={`spec-risk-card ${resolved ? 'resolved' : ''}`} key={item.id}>
                      <div className="spec-risk-card-header">
                        <span>Página {item.page}{item.section ? ` · ${item.section}` : ''}</span>
                        <strong>{resolved ? 'Respondido' : 'Pendente'}</strong>
                      </div>
                      <div className={`spec-risk-evidence ${source.pdfUrl ? '' : 'text-only'}`}>
                        {source.pdfUrl && (
                          <PdfRegionPreview
                            pdfUrl={source.pdfUrl}
                            pageNumber={source.pageNum}
                            bbox={item.bbox}
                            onOpen={() => setPdfReviewItem(item)}
                          />
                        )}
                        <div>
                          <span className="spec-risk-reading-label">LEITURA SUGERIDA</span>
                          <div className="spec-risk-text">“{item.text}”</div>
                          <div className="spec-risk-reason">{item.reason}</div>
                          {source.pdfUrl && (
                            <button
                              type="button"
                              className="spec-risk-pdf-button"
                              onClick={() => setPdfReviewItem(item)}
                            >
                              Ampliar trecho no PDF
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="spec-risk-decision" role="group" aria-label={`Resposta para a dúvida da página ${item.page}`}>
                        <span>Como devemos tratar este trecho?</span>
                        <div className="spec-risk-choice-row">
                          <button
                            type="button"
                            className={decision?.action === 'use' ? 'selected' : ''}
                            aria-pressed={decision?.action === 'use'}
                            onClick={() => onRiskDecisionChange(item.id, { action: 'use', value: item.text })}
                          >
                            Está correto
                          </button>
                          <button
                            type="button"
                            className={decision?.action === 'correct' ? 'selected' : ''}
                            aria-pressed={decision?.action === 'correct'}
                            onClick={() => onRiskDecisionChange(item.id, {
                              action: 'correct',
                              value: decision?.action === 'correct' ? decision.value : '',
                            })}
                          >
                            Quero corrigir
                          </button>
                          <button
                            type="button"
                            className={decision?.action === 'ignore' ? 'selected' : ''}
                            aria-pressed={decision?.action === 'ignore'}
                            onClick={() => onRiskDecisionChange(item.id, { action: 'ignore', value: '' })}
                          >
                            Ignorar trecho
                          </button>
                        </div>
                        {decision?.action === 'correct' && (
                          <label className="spec-risk-correction">
                            Escreva o texto correto
                            <input
                              className="input"
                              value={decision.value}
                              placeholder="Digite exatamente o que está escrito"
                              onChange={(event) => onRiskDecisionChange(item.id, {
                                action: 'correct',
                                value: event.target.value,
                              })}
                              autoFocus
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {!isGenerating && (
        <div className="spec-actions">
          <button className="btn btn-ghost" onClick={onBack}>
            Voltar
          </button>
          <button
            className="btn btn-primary btn-lg"
            onClick={handlePrimaryAction}
            disabled={!spec.trim()}
            id="generate-from-spec-button"
            title={unresolvedRiskCount > 0 ? 'Abrir revisao critica para decidir os riscos pendentes.' : undefined}
          >
            {unresolvedRiskCount > 0 ? `Responder ${unresolvedRiskCount} ${unresolvedRiskCount === 1 ? 'dúvida' : 'dúvidas'}` : 'Gerar resumo final'}
          </button>
        </div>
      )}

      {pdfReviewItem && (
        <div className="pdf-review-overlay" role="dialog" aria-modal="true" aria-labelledby="pdf-review-title">
          <div className="pdf-review-modal">
            <div className="pdf-review-header">
              <div>
                <span>Referência original · página global {pdfReviewItem.page}</span>
                <h3 id="pdf-review-title">{resolvedPdfReview?.sourceName} · página {resolvedPdfReview?.pageNum}</h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPdfReviewItem(null)}
              >
                Fechar
              </button>
            </div>
            <PdfSplitViewer
              pdfUrl={resolvedPdfReview?.pdfUrl}
              activePage={resolvedPdfReview?.pageNum}
              sourceText={`${pdfReviewItem.text}\n${pdfReviewItem.context || ''}`}
              focusRect={pdfReviewItem.bbox}
            />
          </div>
        </div>
      )}
    </div>
  );
}
