import React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './ErrorPages.css';

export interface GenericErrorViewProps {
  /** Optional error title override */
  title?: string;
  /** Optional error message or description */
  description?: string;
  /** Error detail, code, or exception object */
  error?: Error | string | null;
  /** Custom error code to display in the trace box (e.g. ERR_CODE: 500_INTERNAL_SERVER_ERROR) */
  errorCode?: string;
  /** Callback for Retrying the operation */
  onRetry?: () => void;
  /** Callback for Resetting state / Going back */
  onReset?: () => void;
  /** Text for the reset/back button (defaults to "VOLTAR PARA A BIBLIOTECA") */
  resetButtonText?: string;
}

export const GenericErrorView: React.FC<GenericErrorViewProps> = ({
  title = 'Nota de Rodapé Inesperada',
  description = 'Parece que esta página não foi catalogada corretamente. Nossa equipe editorial já está investigando os arquivos.',
  error,
  errorCode = 'ERR_CODE: 500_INTERNAL_SERVER_ERROR',
  onRetry,
  onReset,
  resetButtonText = 'VOLTAR PARA A BIBLIOTECA',
}) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onReset) {
      onReset();
    } else {
      navigate('/app');
    }
  };

  const errorMessageText = typeof error === 'string' 
    ? error 
    : error?.message || 'Ocorreu uma falha inesperada no processamento dos dados.';

  const formattedTimestamp = new Date().toISOString();

  return (
    <div className="error-page-container">
      <main className="error-card-sheet generic-error-card" role="main">
        {/* Tape strip element on top */}
        <div className="error-tape-strip" aria-hidden="true" />

        {/* Red warning circle badge */}
        <div className="error-icon-badge" aria-hidden="true">
          <div className="error-icon-inner">!</div>
        </div>

        {/* Title & Description */}
        <h1 className="error-sheet-title">{title}</h1>
        <p className="error-sheet-description">{description}</p>

        {/* Trace Post-it Box */}
        <div className="error-trace-box">
          <span className="error-trace-badge">TRACE</span>
          <div className="error-trace-content">
            <div className="error-trace-code">{errorCode}</div>
            {errorMessageText && (
              <div style={{ marginTop: '4px', opacity: 0.88 }}>
                {errorMessageText}
              </div>
            )}
            <small className="error-trace-timestamp">
              Timestamp: {formattedTimestamp}
            </small>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="error-actions-group">
          <button 
            type="button" 
            className="btn-error-yellow"
            onClick={handleBack}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            {resetButtonText}
          </button>

          {onRetry && (
            <button 
              type="button" 
              className="btn-error-outline"
              onClick={onRetry}
            >
              <RefreshCw size={18} aria-hidden="true" />
              TENTAR NOVAMENTE
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

export default GenericErrorView;
