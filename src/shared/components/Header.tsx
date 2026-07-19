import type { ReactNode } from 'react';

type HeaderProps = {
  onHome: () => void;
  userActions?: ReactNode;
};

export default function Header({ onHome, userActions }: HeaderProps) {
  return (
    <header className="header">
      <button
        type="button"
        className="header-logo"
        onClick={onHome}
        aria-label="Voltar para a home do Resumex"
      >
        <span className="header-logo-wordmark">Resumex</span>
      </button>

      <div className="header-actions">
        {userActions}
      </div>
    </header>
  );
}
