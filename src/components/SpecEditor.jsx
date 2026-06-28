import { useEffect, useRef, useState } from 'react';
import { formatFileSize } from '../services/pdfExtractor';
import MarkdownPreview from './MarkdownPreview';

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

export default function SpecEditor({
  fileData,
  spec,
  specAudit,
  specCorrectionCount = 0,
  isGenerating,
  onSpecChange,
  onGenerate,
  onRegenerateSpec,
  onBack,
}) {
  const [viewMode, setViewMode] = useState('preview');
  const textareaRef = useRef(null);
  const auditStatus = getAuditStatus(specAudit);
  const auditIssues = getAuditIssues(specAudit);

  useEffect(() => {
    if (isGenerating) setViewMode('preview');
  }, [isGenerating]);

  useEffect(() => {
    if (isGenerating && viewMode === 'edit' && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [spec, isGenerating, viewMode]);

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
        </div>
      )}

      <div className="spec-editor-container">
        {(viewMode === 'preview' || isGenerating) && (
          <div className={`spec-preview-wrapper ${isGenerating ? 'generating' : ''}`}>
            <div className="spec-preview-content" id="spec-preview">
              {spec ? (
                <MarkdownPreview content={spec} />
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-3xl)' }}>
                  {isGenerating ? 'Gerando plano...' : 'Nenhum plano gerado ainda.'}
                </div>
              )}
            </div>
            {isGenerating && (
              <div className="spec-generating-indicator">
                <span className="spec-generating-dot" />
                <span>Preparando plano auditado...</span>
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
            onClick={onGenerate}
            disabled={!spec.trim()}
            id="generate-from-spec-button"
          >
            Gerar resumo final
          </button>
        </div>
      )}
    </div>
  );
}
