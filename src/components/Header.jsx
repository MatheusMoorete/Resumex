export default function Header({ deepseekKey, zhipuKey, deepseekAvailable, zhipuAvailable, onOpenApiKeyModal, userActions }) {
  const hasDS = deepseekAvailable ?? !!deepseekKey;
  const hasZhipu = zhipuAvailable ?? !!zhipuKey;

  const getStatusText = () => {
    if (!hasDS && !hasZhipu) return 'Configurar APIs';
    if (hasDS && hasZhipu) return 'APIs conectadas';
    return 'API parcial';
  };

  return (
    <header className="header">
      <div className="header-logo">
        <div className="header-logo-icon">Rx</div>
        <span className="header-logo-text">
          <span className="gradient-text">ResumeX</span>
        </span>
        <span className="header-logo-badge">MVP</span>
      </div>

      <div className="header-actions">
        <button
          className="api-key-status"
          onClick={onOpenApiKeyModal}
          title="Clique para gerenciar suas chaves de API"
          id="api-key-button"
        >
          <div className="api-key-dots">
            <span className={`api-key-dot ${hasDS ? '' : 'disconnected'}`} title="DeepSeek" />
            <span
              className={`api-key-dot zhipu ${hasZhipu ? '' : 'disconnected'}`}
              title="Zhipu AI (GLM)"
            />
          </div>
          <span className="api-key-status-label">{getStatusText()}</span>
        </button>
        {userActions}
      </div>
    </header>
  );
}
