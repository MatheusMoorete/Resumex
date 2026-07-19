import { useState } from 'react';
import { authService } from '../services/authService';

function GoogleIcon() {
  return (
    <svg className="auth-google-icon" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.614Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.681 9c0-.592.102-1.167.282-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

export default function AuthScreen() {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState('');

  const signInWithGoogle = async () => {
    setIsRedirecting(true);
    setError('');

    try {
      await authService.signInWithGoogle(window.location.origin);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível entrar.');
      setIsRedirecting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-login-backdrop" aria-hidden="true" />
      <main className="auth-login-shell" aria-labelledby="auth-title">
        <section className="auth-login-intro">
          <div className="auth-wordmark" aria-label="Resumex">
            <span className="auth-wordmark-symbol">Rx</span>
            <span>Resumex</span>
          </div>
          <div className="auth-login-copy">
            <p className="auth-eyebrow">Sua área de estudos</p>
            <h1 id="auth-title">Transforme material em conhecimento.</h1>
            <p>
              Crie resumos estruturados e quizzes a partir dos seus PDFs, sem perder o contexto importante.
            </p>
          </div>
          <p className="auth-intro-note">Leitura. Síntese. Revisão.</p>
        </section>

        <section className="auth-login-card" aria-labelledby="auth-card-title">
          <div className="auth-card-heading">
            <p className="auth-eyebrow">Bem-vindo</p>
            <h2 id="auth-card-title">Entre na sua conta</h2>
            <p>Use sua conta Google para continuar no Resumex.</p>
          </div>

          <button
            className="auth-google-button"
            type="button"
            onClick={signInWithGoogle}
            disabled={isRedirecting}
          >
            {isRedirecting ? <span className="auth-button-spinner" aria-hidden="true" /> : <GoogleIcon />}
            <span>{isRedirecting ? 'Conectando ao Google…' : 'Continuar com Google'}</span>
          </button>

          <p className="auth-provider-note">
            Você será direcionado ao Google para concluir a autenticação.
          </p>

          {error && (
            <div className="auth-error" role="alert" aria-live="polite">
              {error}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
