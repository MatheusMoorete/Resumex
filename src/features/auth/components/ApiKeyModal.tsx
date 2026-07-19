import { useState } from 'react';

export default function ApiKeyModal({ deepseekKey, zhipuKey, onSave, onClose }) {
  const [dsKey, setDsKey] = useState(deepseekKey || '');
  const [zKey, setZKey] = useState(zhipuKey || '');

  const handleSave = () => {
    onSave({
      deepseek: dsKey.trim(),
      zhipu: zKey.trim(),
    });
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') handleSave();
    if (event.key === 'Escape') onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2 className="modal-title">Configurar Chaves de API</h2>
        <p className="modal-description">
          Insira chaves locais apenas se quiser sobrescrever as chaves configuradas no servidor.
        </p>

        <div className="modal-info">
          <span>
            Em produção, prefira configurar DeepSeek e GLM no backend por variáveis de ambiente.
          </span>
        </div>

        <div className="modal-field" style={{ marginBottom: 'var(--space-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
            <label className="modal-label" htmlFor="ds-key-input" style={{ margin: 0 }}>
              Chave API do DeepSeek
            </label>
            <a
              href="https://platform.deepseek.com/api_keys"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-cyan)', textDecoration: 'none' }}
            >
              Obter chave
            </a>
          </div>
          <input
            id="ds-key-input"
            className="input"
            type="password"
            placeholder="sk-..."
            value={dsKey}
            onChange={(event) => setDsKey(event.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>

        <div className="modal-field" style={{ marginBottom: 'var(--space-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
            <label className="modal-label" htmlFor="zhipu-key-input" style={{ margin: 0 }}>
              Chave API do Zhipu AI / GLM
            </label>
            <a
              href="https://open.bigmodel.cn/usercenter/apikeys"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-cyan)', textDecoration: 'none' }}
            >
              Obter chave
            </a>
          </div>
          <input
            id="zhipu-key-input"
            className="input"
            type="password"
            placeholder="api_key..."
            value={zKey}
            onChange={(event) => setZKey(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="modal-actions" style={{ marginTop: 'var(--space-xl)' }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Salvar configurações
          </button>
        </div>
      </div>
    </div>
  );
}
