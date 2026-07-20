import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './app/App';
import './app/App.css';
import { authService } from './features/auth/services/authService';
import LandingPage from './features/landing/LandingPage';

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
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/como-funciona" element={<LandingPage />} />
        <Route path="/medicina" element={<LandingPage />} />
        <Route path="/recursos" element={<LandingPage />} />
        <Route path="/planos" element={<LandingPage />} />
        <Route path="/app/*" element={authService.isConfigured ? <App /> : <MissingAuthConfig />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
