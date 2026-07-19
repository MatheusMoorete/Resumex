import { createClient, type Session } from '@supabase/supabase-js';
import type { AuthService, AuthSession } from '../domain/auth';

const authDebugEnabled = import.meta.env.VITE_AUTH_DEBUG === 'true';

function authDebug(event: string, details: Record<string, unknown> = {}) {
  if (!authDebugEnabled) return;
  console.info(`[auth] ${event}`, details);
}

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return { message: 'Unknown authentication error' };

  const authError = error as Error & { code?: string; status?: number };
  return {
    name: authError.name,
    message: authError.message,
    code: authError.code,
    status: authError.status,
  };
}

function readOAuthCallbackError() {
  if (typeof window === 'undefined') return null;

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const value = (key: string) => query.get(key) || hash.get(key);
  const error = value('error');
  const errorCode = value('error_code');
  const errorDescription = value('error_description');

  if (!error && !errorCode && !errorDescription) return null;
  return { error, errorCode, errorDescription };
}

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
  const callbackError = readOAuthCallbackError();

  authDebug('provider initialized', {
    provider: 'supabase',
    configured: isConfigured,
    origin: typeof window === 'undefined' ? null : window.location.origin,
    callbackErrorDetected: Boolean(callbackError),
  });

  if (callbackError) {
    console.error('[auth] OAuth callback failed', callbackError);
  }

  return {
    isConfigured,

    async getSession() {
      if (!client) {
        authDebug('session lookup skipped', { reason: 'provider_not_configured' });
        return null;
      }

      authDebug('session lookup started');

      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        authDebug('session lookup completed', { hasSession: Boolean(data.session) });
        return toAuthSession(data.session);
      } catch (error) {
        console.error('[auth] session lookup failed', safeErrorDetails(error));
        throw error;
      }
    },

    onAuthStateChange(listener) {
      if (!client) return () => undefined;

      const { data } = client.auth.onAuthStateChange((event, session) => {
        authDebug('state changed', { event, hasSession: Boolean(session) });
        listener(toAuthSession(session));
      });

      return () => data.subscription.unsubscribe();
    },

    async signInWithGoogle(redirectTo) {
      if (!client) throw new Error('Serviço de autenticação não configurado.');
      authDebug('OAuth sign-in started', {
        provider: 'google',
        redirectOrigin: new URL(redirectTo).origin,
      });

      try {
        const { error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo },
        });
        if (error) throw error;
      } catch (error) {
        console.error('[auth] OAuth sign-in failed', safeErrorDetails(error));
        throw error;
      }
    },

    async signOut() {
      if (!client) return;
      authDebug('sign-out started');

      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
        authDebug('sign-out completed');
      } catch (error) {
        console.error('[auth] sign-out failed', safeErrorDetails(error));
        throw error;
      }
    },
  };
}
