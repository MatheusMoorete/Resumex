import { useEffect, useRef, useState } from 'react';
import { formatFileSize } from '../../pdf/services/pdfExtractor';
import { resolveCorpusPage } from '../../pdf/services/pdfCorpus';
import MarkdownPreview from '../../../shared/components/MarkdownPreview';
import PdfSplitViewer from '../../pdf/components/PdfSplitViewer';
import PdfRegionPreview from './PdfRegionPreview';
import pdfIcon from '../../../assets/pdf_icon.png';

function getAuditStatus(specAudit) {
  if (!specAudit) return 'Pendente';
  const match = specAudit.match(/\*\*Status:\*\*\s*([^\n]+)/i);
  return match ? match[1].trim() : 'Pendente';
}

function getAuditIssues(specAudit) {
  if (!specAudit) return [];
  return specAudit
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(\d+\.|-)\s+/.test(line))
    .slice(0, 6);
}

function isRiskDecisionResolved(decision) {
  if (!decision) return false;
  if (decision.action === 'correct') return Boolean(decision.value?.trim());
  return true;
}

const GENERATION_STAGES = [
  { id: 'evidence', label: 'Mapeando evidências', description: 'Relacionando os conceitos às páginas de origem e preservando o contexto do material.' },
  { id: 'structure', label: 'Montando a estrutura', description: 'Aplicando o método, os formatos e a profundidade escolhidos por você.' },
  { id: 'audit', label: 'Auditando e corrigindo', description: 'Verificando inconsistências com um segundo modelo antes de liberar o plano.' },
];

export default function SpecEditor({
  fileData,
  spec,
  specAudit,
  specCorrectionCount = 0,
  highRiskItems = [],
  riskDecisions = {},
  isGenerating,
  generationStage = 'evidence',
  onSpecChange,
  onRiskDecisionChange,
  onGenerate,
  onRegenerateSpec,
  onBack,
  isVisualReview = false,
}) {
  const [viewMode, setViewMode] = useState('preview');
  const [pdfReviewItem, setPdfReviewItem] = useState(null);
  const textareaRef = useRef(null);
  const correctionInputRef = useRef(null);
  const hasAudit = Boolean(specAudit?.trim());
  const auditStatus = getAuditStatus(specAudit);
  const auditIssues = getAuditIssues(specAudit);
  const unresolvedRiskCount = highRiskItems.filter((item) => !isRiskDecisionResolved(riskDecisions[item.id])).length;
  const completedRiskCount = highRiskItems.length - unresolvedRiskCount;
  const normalizedGenerationStage = generationStage === 'correction' ? 'audit' : generationStage;
  const generationStageIndex = Math.max(0, GENERATION_STAGES.findIndex((item) => item.id === normalizedGenerationStage));
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
    window.setTimeout(() => correctionInputRef.current?.focus(), 80);
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
              ? 'Criando mapa de evidências, estruturando e auditando o plano.'
              : isVisualReview
                ? 'Confira o plano e responda apenas às dúvidas visuais antes de gerar o resumo.'
                : 'Confira a estrutura antes de gerar. A auditoria permanece separada do conteúdo do resumo.'}
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
            {hasAudit && (
              <button
                className={`result-tab ${viewMode === 'audit' ? 'active' : ''}`}
                onClick={() => setViewMode('audit')}
              >
                Auditoria
              </button>
            )}
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

      {!isGenerating && !isVisualReview && (
        <div className="spec-quality-bar">
          <div>
            <span className="spec-quality-label">Status da auditoria</span>
            <strong>{auditStatus}</strong>
          </div>
          <div>
            <span className="spec-quality-label">Correções automáticas</span>
            <strong>{specCorrectionCount}</strong>
          </div>
          <div>
            <span className="spec-quality-label">Ajustes pendentes</span>
            <strong>{auditIssues.length}</strong>
          </div>
          <div>
            <span className="spec-quality-label">Riscos sem decisão</span>
            <strong>{unresolvedRiskCount}</strong>
          </div>
        </div>
      )}

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
                    <strong>{generationStage === 'correction' ? 'Corrigindo inconsistências' : currentGenerationStage.label}</strong>
                    <p>{generationStage === 'correction' ? 'A auditoria encontrou ajustes e o plano está sendo corrigido antes de uma nova verificação.' : currentGenerationStage.description}</p>
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
                <span>Etapa {generationStageIndex + 1} de {GENERATION_STAGES.length} · {generationStage === 'correction' ? 'Corrigindo inconsistências encontradas' : currentGenerationStage.label}</span>
              </div>
            )}
          </div>
        )}

        {viewMode === 'audit' && !isGenerating && (
          <div className="spec-audit-layout">
            <aside className="spec-audit-summary">
              <h3>Inconsistencias encontradas</h3>
              {auditIssues.length > 0 ? (
                auditIssues.map((issue, index) => (
                  <div className="spec-audit-card" key={`${issue}-${index}`}>
                    {issue.replace(/^(\d+\.|-)\s+/, '')}
                  </div>
                ))
              ) : (
                <div className="spec-audit-card muted">Nenhuma inconsistencia acionavel identificada.</div>
              )}
            </aside>
            <div className="spec-preview-wrapper">
              <div className="spec-preview-content">
                {specAudit ? (
                  <MarkdownPreview content={specAudit} />
                ) : (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-3xl)' }}>
                    Nenhuma auditoria disponivel.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {viewMode === 'edit' && !isGenerating && (
          <div className="spec-editor-wrapper">
            <div className="spec-edit-helper">
              Edite apenas o plano que sera enviado ao DeepSeek. A auditoria fica separada para consulta.
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
                Passe o mouse sobre a imagem para ampliar. Clique para conferir o PDF e responder. {completedRiskCount} de {highRiskItems.length} revisadas.
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
                  const answerLabel = decision?.action === 'ignore'
                    ? 'Este trecho será ignorado'
                    : decision?.action === 'use'
                      ? 'Leitura sugerida confirmada'
                      : decision?.action === 'correct'
                        ? `Correção: ${decision.value}`
                        : '';
                  return (
                    <div className={`spec-risk-card ${resolved ? 'resolved' : ''}`} key={item.id}>
                      <div className="spec-risk-card-header">
                        <span>Pagina {item.page}{item.section ? ` · ${item.section}` : ''}</span>
                        <strong>{resolved ? 'Resolvido' : 'Pendente'}</strong>
                      </div>
                      <div className="spec-risk-evidence">
                        {source.pdfUrl && (
                          <PdfRegionPreview
                            pdfUrl={source.pdfUrl}
                            pageNumber={source.pageNum}
                            bbox={item.bbox}
                            onOpen={() => setPdfReviewItem(item)}
                          />
                        )}
                        <div>
                          <div className="spec-risk-text">{item.text}</div>
                          <div className="spec-risk-reason">{item.reason}</div>
                          {answerLabel && <div className="spec-risk-answer">{answerLabel}</div>}
                          <button
                            type="button"
                            className="spec-risk-pdf-button"
                            onClick={() => setPdfReviewItem(item)}
                          >
                            {resolved ? 'Revisar resposta' : 'Conferir e responder'}
                          </button>
                        </div>
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
          {onRegenerateSpec && (
            <button className="btn btn-secondary" onClick={onRegenerateSpec}>
              Regenerar plano
            </button>
          )}
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
            <aside className="pdf-review-question">
              <span className="spec-header-kicker">CONFIRME A LEITURA</span>
              <h3>O que está escrito nesta região?</h3>
              <p><strong>Leitura sugerida:</strong> {pdfReviewItem.text}</p>
              <p>{pdfReviewItem.reason}</p>
              <div className="pdf-review-actions">
                <button
                  type="button"
                  className={`btn btn-secondary ${riskDecisions[pdfReviewItem.id]?.action === 'use' ? 'selected' : ''}`}
                  onClick={() => onRiskDecisionChange(pdfReviewItem.id, { action: 'use', value: pdfReviewItem.text })}
                >
                  Está correto
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary ${riskDecisions[pdfReviewItem.id]?.action === 'ignore' ? 'selected' : ''}`}
                  onClick={() => onRiskDecisionChange(pdfReviewItem.id, { action: 'ignore', value: '' })}
                >
                  Ignorar trecho
                </button>
              </div>
              <label className="spec-risk-correction">
                Se estiver diferente, escreva a correção
                <input
                  ref={correctionInputRef}
                  className="input"
                  value={riskDecisions[pdfReviewItem.id]?.action === 'correct' ? riskDecisions[pdfReviewItem.id].value : ''}
                  placeholder="Digite exatamente o que está escrito"
                  onChange={(event) => onRiskDecisionChange(pdfReviewItem.id, {
                    action: 'correct',
                    value: event.target.value,
                  })}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!isRiskDecisionResolved(riskDecisions[pdfReviewItem.id])}
                onClick={() => setPdfReviewItem(null)}
              >
                Salvar e fechar
              </button>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
