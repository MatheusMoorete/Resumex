import { useEffect, useRef, useState } from 'react';
import { formatFileSize } from '../../pdf/services/pdfExtractor';
import MarkdownPreview from '../../../shared/components/MarkdownPreview';
import PdfSplitViewer from '../../pdf/components/PdfSplitViewer';

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

export default function SpecEditor({
  fileData,
  spec,
  specAudit,
  specCorrectionCount = 0,
  highRiskItems = [],
  riskDecisions = {},
  isGenerating,
  onSpecChange,
  onRiskDecisionChange,
  onGenerate,
  onRegenerateSpec,
  onBack,
}) {
  const [viewMode, setViewMode] = useState('preview');
  const [pdfReviewItem, setPdfReviewItem] = useState(null);
  const textareaRef = useRef(null);
  const auditStatus = getAuditStatus(specAudit);
  const auditIssues = getAuditIssues(specAudit);
  const unresolvedRiskCount = highRiskItems.filter((item) => !isRiskDecisionResolved(riskDecisions[item.id])).length;
  const completedRiskCount = highRiskItems.length - unresolvedRiskCount;

  useEffect(() => {
    if (isGenerating) setViewMode('preview');
  }, [isGenerating]);

  useEffect(() => {
    if (isGenerating && viewMode === 'edit' && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [spec, isGenerating, viewMode]);

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
          <div className="uploaded-file-icon">PDF</div>
          <div className="uploaded-file-info">
            <div className="uploaded-file-name">{fileData.name}</div>
            <div className="uploaded-file-meta">
              {fileData.numPages} {fileData.numPages === 1 ? 'pagina' : 'paginas'} · {formatFileSize(fileData.size)}
            </div>
          </div>
        </div>
      </div>

      <div className="spec-header-bar">
        <div className="spec-header-left">
          <h2>{isGenerating ? 'Analisando material' : 'Plano do resumo'}</h2>
          <p>
            {isGenerating
              ? 'Criando mapa de evidencias, corrigindo a SPEC e auditando o plano.'
              : 'Revise o plano final. A auditoria fica separada e nao sera enviada como parte da SPEC.'}
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
              className={`result-tab ${viewMode === 'audit' ? 'active' : ''}`}
              onClick={() => setViewMode('audit')}
            >
              Auditoria
            </button>
            <button
              className={`result-tab ${viewMode === 'risk' ? 'active' : ''}`}
              onClick={() => setViewMode('risk')}
            >
              Revisao critica
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

      {!isGenerating && (
        <div className="spec-quality-bar">
          <div>
            <span className="spec-quality-label">Status da auditoria</span>
            <strong>{auditStatus}</strong>
          </div>
          <div>
            <span className="spec-quality-label">Correcoes automaticas</span>
            <strong>{specCorrectionCount}</strong>
          </div>
          <div>
            <span className="spec-quality-label">Ajustes pendentes</span>
            <strong>{auditIssues.length}</strong>
          </div>
          <div>
            <span className="spec-quality-label">Riscos sem decisao</span>
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
            A IA corrigiu automaticamente o plano, mas ainda restaram {unresolvedRiskCount} {unresolvedRiskCount === 1 ? 'ponto' : 'pontos'} de baixa confianca.
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
                  <h3>Transformando a leitura em uma SPEC auditavel</h3>
                  <p>
                    Estamos organizando as evidencias por pagina, aplicando suas preferencias e checando inconsistencias antes da revisao final.
                  </p>
                  <div className="spec-generation-steps">
                    <div className="spec-generation-step done">
                      <span />
                      <strong>Material analisado</strong>
                    </div>
                    <div className={`spec-generation-step ${spec ? 'done' : 'active'}`}>
                      <span />
                      <strong>Estrutura do plano</strong>
                    </div>
                    <div className={`spec-generation-step ${spec ? 'active' : ''}`}>
                      <span />
                      <strong>Auditoria e correcao</strong>
                    </div>
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
                <span>Gerando plano auditado. Esta etapa pode levar alguns segundos apos a leitura das paginas.</span>
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
              <h3>Revisao obrigatoria de alto risco</h3>
              <p>
                Confirme trechos incertos que podem alterar valores, condutas, classificacoes ou protocolos. {completedRiskCount} de {highRiskItems.length} revisados.
              </p>
            </div>

            {highRiskItems.length === 0 ? (
              <div className="spec-risk-empty">
                Nenhum manuscrito ou valor incerto de alto risco foi detectado.
              </div>
            ) : (
              <div className="spec-risk-list">
                {highRiskItems.map((item) => {
                  const decision = riskDecisions[item.id];
                  const resolved = isRiskDecisionResolved(decision);
                  return (
                    <div className={`spec-risk-card ${resolved ? 'resolved' : ''}`} key={item.id}>
                      <div className="spec-risk-card-header">
                        <span>Pagina {item.page}{item.section ? ` · ${item.section}` : ''}</span>
                        <strong>{resolved ? 'Resolvido' : 'Pendente'}</strong>
                      </div>
                      <div className="spec-risk-text">{item.text}</div>
                      <div className="spec-risk-reason">{item.reason}</div>
                      {fileData.pdfUrl && (
                        <button
                          type="button"
                          className="spec-risk-pdf-button"
                          onClick={() => setPdfReviewItem(item)}
                        >
                          Ver pagina no PDF
                        </button>
                      )}

                      <div className="spec-risk-actions">
                        <button
                          type="button"
                          className={`btn btn-secondary ${decision?.action === 'ignore' ? 'selected' : ''}`}
                          onClick={() => onRiskDecisionChange(item.id, { action: 'ignore', value: '' })}
                        >
                          Ignorar
                        </button>
                        <button
                          type="button"
                          className={`btn btn-secondary ${decision?.action === 'use' ? 'selected' : ''}`}
                          onClick={() => onRiskDecisionChange(item.id, { action: 'use', value: item.text })}
                        >
                          Usar literal
                        </button>
                      </div>

                      <label className="spec-risk-correction">
                        Corrigir manualmente
                        <input
                          className="input"
                          value={decision?.action === 'correct' ? decision.value : ''}
                          placeholder="Digite o trecho confirmado"
                          onChange={(event) => onRiskDecisionChange(item.id, {
                            action: 'correct',
                            value: event.target.value,
                          })}
                        />
                      </label>
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
          <button className="btn btn-secondary" onClick={onRegenerateSpec}>
            Regenerar plano
          </button>
          <button
            className="btn btn-primary btn-lg"
            onClick={handlePrimaryAction}
            disabled={!spec.trim()}
            id="generate-from-spec-button"
            title={unresolvedRiskCount > 0 ? 'Abrir revisao critica para decidir os riscos pendentes.' : undefined}
          >
            {unresolvedRiskCount > 0 ? `Resolver ${unresolvedRiskCount} riscos` : 'Gerar resumo final'}
          </button>
        </div>
      )}

      {pdfReviewItem && (
        <div className="pdf-review-overlay" role="dialog" aria-modal="true">
          <div className="pdf-review-modal">
            <div className="pdf-review-header">
              <div>
                <span>Referencia original</span>
                <h3>Pagina {pdfReviewItem.page}</h3>
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
              pdfUrl={fileData.pdfUrl}
              activePage={pdfReviewItem.page}
              sourceText={`${pdfReviewItem.text}\n${pdfReviewItem.context || ''}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
