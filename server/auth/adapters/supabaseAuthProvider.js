import { createClient } from '@supabase/supabase-js';

export function createSupabaseAuthProvider(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  const client = url && publishableKey
    ? createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  return {
    name: 'supabase',
    isConfigured: Boolean(client),

    async verifyToken(token) {
      if (!client || !token) return null;

      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;

      return {
        id: data.user.id,
        email: data.user.email ?? null,
      };
    },
  };
}
