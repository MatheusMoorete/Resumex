import { TEMPLATES } from '../prompts/templates';
import { formatFileSize } from '../services/pdfExtractor';

export default function TemplateSelector({ fileData, selectedTemplate, onSelectTemplate, onGenerate, onBack }) {
  return (
    <div className="template-section">
      {/* Uploaded file info */}
      <div className="uploaded-file" style={{ maxWidth: '600px', width: '100%' }}>
        <div className="uploaded-file-icon">📄</div>
        <div className="uploaded-file-info">
          <div className="uploaded-file-name">{fileData.name}</div>
          <div className="uploaded-file-meta">
            {fileData.numPages} {fileData.numPages === 1 ? 'página' : 'páginas'} · {formatFileSize(fileData.size)}
          </div>
        </div>
        <button className="uploaded-file-remove" onClick={onBack} title="Remover arquivo">
          ✕
        </button>
      </div>

      {/* Template selection */}
      <div className="template-header">
        <h2>Escolha o formato do resumo</h2>
        <p>Selecione como você quer estruturar seu material de estudo no Notion</p>
      </div>

      <div className="template-grid">
        {TEMPLATES.map((template) => (
          <div
            key={template.id}
            className={`glass-card template-card ${selectedTemplate === template.id ? 'selected' : ''}`}
            onClick={() => onSelectTemplate(template.id)}
            role="button"
            tabIndex={0}
            id={`template-${template.id}`}
          >
            <div className="template-card-icon">{template.icon}</div>
            <div className="template-card-title">{template.name}</div>
            <div className="template-card-desc">{template.description}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="template-actions">
        <button className="btn btn-secondary" onClick={onBack}>
          ← Voltar
        </button>
        <button
          className="btn btn-primary btn-lg"
          onClick={onGenerate}
          disabled={!selectedTemplate}
          id="generate-button"
        >
          ✨ Gerar Resumo
        </button>
      </div>
    </div>
  );
}
