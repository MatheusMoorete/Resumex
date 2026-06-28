import { useState, useEffect, useRef } from 'react';
import { formatFileSize } from '../services/pdfExtractor';
import MarkdownPreview from './MarkdownPreview';

export default function SpecEditor({ fileData, spec, isGenerating, onSpecChange, onGenerate, onRegenerateSpec, onBack }) {
  const [viewMode, setViewMode] = useState('preview'); // 'preview' | 'edit'
  const textareaRef = useRef(null);

  // While generating, always show preview mode
  // Once done, stay on preview
  useEffect(() => {
    if (isGenerating) {
      setViewMode('preview');
    }
  }, [isGenerating]);

  // Auto-scroll textarea when in edit mode during generation
  useEffect(() => {
    if (isGenerating && viewMode === 'edit' && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [spec, isGenerating, viewMode]);

  return (
    <div className="spec-section">
      {/* File info bar */}
      <div className="spec-file-bar">
        <div className="uploaded-file" style={{ flex: 1 }}>
          <div className="uploaded-file-icon">📄</div>
          <div className="uploaded-file-info">
            <div className="uploaded-file-name">{fileData.name}</div>
            <div className="uploaded-file-meta">
              {fileData.numPages} {fileData.numPages === 1 ? 'página' : 'páginas'} · {formatFileSize(fileData.size)}
            </div>
          </div>
        </div>
      </div>

      {/* Header with tabs */}
      <div className="spec-header-bar">
        <div className="spec-header-left">
          <h2>
            {isGenerating ? '⏳ Analisando seu material...' : '📋 Plano do Resumo'}
          </h2>
          <p>
            {isGenerating
              ? 'A IA está lendo o PDF e propondo uma estrutura.'
              : 'Revise o plano abaixo. Edite livremente antes de gerar o resumo final.'
            }
          </p>
        </div>

        {!isGenerating && (
          <div className="spec-view-tabs">
            <button
              className={`result-tab ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
            >
              👁️ Visualizar
            </button>
            <button
              className={`result-tab ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => setViewMode('edit')}
            >
              ✏️ Editar
            </button>
          </div>
        )}
      </div>

      {/* Tips (shown when editable) */}
      {!isGenerating && viewMode === 'edit' && (
        <div className="spec-tips">
          <div className="spec-tip">💡 Adicione: <em>"Criar mnemônicos para decorar"</em></div>
          <div className="spec-tip">✂️ Apague seções que não quer</div>
          <div className="spec-tip">📊 Peça: <em>"Tabela comparando X vs Y"</em></div>
        </div>
      )}

      {/* Content area */}
      <div className="spec-editor-container">
        {viewMode === 'preview' || isGenerating ? (
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
                <span>Gerando plano...</span>
              </div>
            )}
          </div>
        ) : (
          <div className="spec-editor-wrapper">
            <textarea
              ref={textareaRef}
              className="spec-textarea"
              value={spec}
              onChange={(e) => onSpecChange(e.target.value)}
              placeholder="O plano do resumo aparecerá aqui..."
              spellCheck={false}
              id="spec-editor"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      {!isGenerating && (
        <div className="spec-actions">
          <button className="btn btn-ghost" onClick={onBack}>
            ← Voltar
          </button>
          <button className="btn btn-secondary" onClick={onRegenerateSpec}>
            🔄 Regenerar Plano
          </button>
          <button
            className="btn btn-primary btn-lg"
            onClick={onGenerate}
            disabled={!spec.trim()}
            id="generate-from-spec-button"
          >
            ✨ Gerar Resumo Final
          </button>
        </div>
      )}
    </div>
  );
}
