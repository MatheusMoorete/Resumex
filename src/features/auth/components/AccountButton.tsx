import type { AuthUser } from '../domain/auth';
import { authService } from '../services/authService';

export default function AccountButton({ user }: { user: AuthUser }) {
  const email = user.email || 'Conta';

  return (
    <button
      className="account-button"
      type="button"
      title={`${email} — sair`}
      aria-label={`Sair da conta ${email}`}
      onClick={() => void authService.signOut()}
    >
      {email.charAt(0).toUpperCase()}
    </button>
  );
}
