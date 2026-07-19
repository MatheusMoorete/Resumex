import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './app/App.css';
import { authService } from './features/auth/services/authService';

function MissingAuthConfig() {
  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="header-logo-icon">Rx</div>
          <div>
            <h1>ResumeX</h1>
            <p>Autenticação não configurada</p>
          </div>
        </div>
        <div className="upload-error">
          Configure o provedor de autenticação para habilitar o login.
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {authService.isConfigured ? <App /> : <MissingAuthConfig />}
  </StrictMode>,
);
