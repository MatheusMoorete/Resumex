import { createClient } from '@supabase/supabase-js';

export function createSupabaseAuthProvider(env) {
  const debugEnabled = env.AUTH_DEBUG === 'true';
  const debug = (event, details = {}) => {
    if (debugEnabled) console.info(`[auth:server] ${event}`, details);
  };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  const client = url && publishableKey
    ? createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  debug('provider initialized', {
    provider: 'supabase',
    configured: Boolean(client),
  });

  return {
    name: 'supabase',
    isConfigured: Boolean(client),

    async verifyToken(token) {
      if (!client || !token) {
        debug('token verification skipped', {
          reason: !client ? 'provider_not_configured' : 'token_missing',
        });
        return null;
      }

      debug('token verification started');

      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) {
        console.error('[auth:server] token verification failed', {
          message: error?.message || 'User not returned by provider',
          code: error?.code,
          status: error?.status,
        });
        return null;
      }

      debug('token verification completed', { authenticated: true });

      return {
        id: data.user.id,
        email: data.user.email ?? null,
      };
    },
  };
}
