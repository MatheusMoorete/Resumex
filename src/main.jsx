import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { ptBR } from '@clerk/localizations';
import App from './App.jsx';
import './App.css';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function MissingClerkConfig() {
  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="header-logo-icon">Rx</div>
          <div>
            <h1>ResumeX</h1>
            <p>Clerk não configurado</p>
          </div>
        </div>
        <div className="upload-error">
          Configure VITE_CLERK_PUBLISHABLE_KEY para habilitar login com Google.
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider
        publishableKey={clerkPublishableKey}
        afterSignOutUrl="/"
        localization={ptBR}
        appearance={{
          variables: {
            colorPrimary: '#8fb8a8',
            colorBackground: '#171c18',
            colorInputBackground: '#202720',
            colorInputText: '#f3efe7',
            colorText: '#f3efe7',
            colorTextSecondary: '#b8b4aa',
            colorNeutral: '#8f8a80',
            borderRadius: '8px',
            fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
          },
          elements: {
            card: 'clerk-card',
            rootBox: 'clerk-root-box',
            headerTitle: 'clerk-header-title',
            headerSubtitle: 'clerk-header-subtitle',
            socialButtonsBlockButton: 'clerk-social-button',
            footerAction: 'clerk-footer-action',
            footer: 'clerk-footer',
            formButtonPrimary: 'clerk-primary-button',
          },
        }}
      >
        <App />
      </ClerkProvider>
    ) : (
      <MissingClerkConfig />
    )}
  </StrictMode>,
);
