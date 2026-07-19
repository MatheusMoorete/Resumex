import { createSupabaseAuthService } from '../adapters/supabaseAuthService';
import type { AuthService } from '../domain/auth';

const factories: Record<string, () => AuthService> = {
  supabase: createSupabaseAuthService,
};

const providerName = (import.meta.env.VITE_AUTH_PROVIDER || 'supabase').toLowerCase();
const factory = factories[providerName];

if (!factory) {
  throw new Error(`Provedor de autenticação não suportado: ${providerName}`);
}

// Ponto único de composição: trocar o provedor exige apenas outro adaptador e registro.
export const authService: AuthService = factory();
