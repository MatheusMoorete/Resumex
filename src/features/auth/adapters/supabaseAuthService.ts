import { createClient, type Session } from '@supabase/supabase-js';
import type { AuthService, AuthSession } from '../domain/auth';

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session) return null;

  return {
    accessToken: session.access_token,
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
    },
  };
}

export function createSupabaseAuthService(): AuthService {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const isConfigured = Boolean(url && publishableKey);
  const client = isConfigured ? createClient(url, publishableKey) : null;

  return {
    isConfigured,

    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return toAuthSession(data.session);
    },

    onAuthStateChange(listener) {
      if (!client) return () => undefined;

      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toAuthSession(session));
      });

      return () => data.subscription.unsubscribe();
    },

    async signInWithGoogle(redirectTo) {
      if (!client) throw new Error('Serviço de autenticação não configurado.');
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) throw error;
    },

    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
  };
}
