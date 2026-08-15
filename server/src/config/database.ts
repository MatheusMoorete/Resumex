import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseAdminClient(env: Record<string, string | undefined> = process.env): SupabaseClient | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getSupabaseUserClient(userAccessToken: string, env: Record<string, string | undefined> = process.env): SupabaseClient | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

  if (!url || !publishableKey || !userAccessToken) {
    return null;
  }

  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    },
  });
}
