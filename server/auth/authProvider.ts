import { createSupabaseAuthProvider, AuthProvider } from './adapters/supabaseAuthProvider.js';

const factories: Record<string, (env: Record<string, string | undefined>) => AuthProvider> = {
  supabase: createSupabaseAuthProvider,
};

export function createAuthProvider(env: Record<string, string | undefined> = process.env): AuthProvider {
  const providerName = (env.AUTH_PROVIDER || 'supabase').toLowerCase();
  const factory = factories[providerName];

  if (!factory) {
    throw new Error(`Unsupported AUTH_PROVIDER: ${providerName}`);
  }

  return factory(env);
}

export type { AuthUser, AuthProvider } from './adapters/supabaseAuthProvider.js';
