import { createSupabaseAuthProvider } from './adapters/supabaseAuthProvider.js';

const factories = {
  supabase: createSupabaseAuthProvider,
};

export function createAuthProvider(env = process.env) {
  const providerName = (env.AUTH_PROVIDER || 'supabase').toLowerCase();
  const factory = factories[providerName];

  if (!factory) {
    throw new Error(`Unsupported AUTH_PROVIDER: ${providerName}`);
  }

  return factory(env);
}
