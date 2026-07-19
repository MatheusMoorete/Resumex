import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, LogOut, Menu, X } from 'lucide-react';
import type { AuthUser } from '../domain/auth';
import { authService } from '../services/authService';

type AccountButtonProps = {
  user: AuthUser;
  onStudyCenter?: () => void;
};

export default function AccountButton({ user, onStudyCenter }: AccountButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const email = user.email || 'Conta';
  const closeMenu = () => setIsClosing(true);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button
        className="account-button"
        type="button"
        title="Abrir menu"
        aria-label="Abrir menu lateral"
        aria-expanded={isOpen}
        aria-controls="account-side-menu"
        onClick={() => {
          setIsClosing(false);
          setIsOpen(true);
        }}
      >
        <Menu aria-hidden="true" />
      </button>

      {isOpen && createPortal(
        <div
          className={`side-menu-backdrop side-menu-backdrop--fichario ${isClosing ? 'is-closing' : ''}`}
          onClick={closeMenu}
          onAnimationEnd={(event) => {
            if (isClosing && event.target === event.currentTarget) {
              setIsOpen(false);
              setIsClosing(false);
            }
          }}
        >
          <aside
            className="side-menu side-menu--fichario"
            id="account-side-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu da conta"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="side-menu-header">
              <span className="side-menu-title">
                <span className="side-menu-eyebrow">FICHÁRIO / NAVEGAÇÃO</span>
                <strong>Sua mesa</strong>
                <small>{email}</small>
              </span>
              <button
                ref={closeButtonRef}
                className="side-menu-close"
                type="button"
                aria-label="Fechar menu lateral"
                onClick={closeMenu}
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <nav className="side-menu-nav" aria-label="Navegação da conta">
              <button
                type="button"
                onClick={() => {
                  onStudyCenter?.();
                  closeMenu();
                }}
              >
                <BookOpen aria-hidden="true" />
                Central de estudo
              </button>
              <button className="side-menu-sign-out" type="button" onClick={() => void authService.signOut()}>
                <LogOut aria-hidden="true" />
                Sair
              </button>
            </nav>
          </aside>
        </div>,
        document.body
      )}
    </>
  );
}
