import { providers, upstreamTimeoutMs } from '../config/env.js';
import {
  ALL_AUDIT_ROLES,
  getConfiguredAuditors,
  logAiUsage,
  normalizeAiPayload,
  resolveAiRoute,
} from '../routes/aiProxy.js';

const callsBySignal = new WeakMap<AbortSignal, number>();

function responseContent(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((item) => item?.text || '').join('').trim();
  return '';
}

export async function callServerAi({
  system,
  user,
  signal,
  role,
  maxTokens,
  temperature,
  maxCalls = 30,
}: {
  system: string;
  user: string;
  signal?: AbortSignal;
  role: string;
  maxTokens: number;
  temperature: number;
  maxCalls?: number;
}): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (signal) {
    const calls = (callsBySignal.get(signal) || 0) + 1;
    if (calls > maxCalls) throw new Error(`O processamento excedeu o limite interno de ${maxCalls} chamadas de IA.`);
    callsBySignal.set(signal, calls);
  }

  const primaryRoute = resolveAiRoute(role);
  if (!primaryRoute) throw new Error(`Papel de IA inválido: ${role}.`);
  const candidates = ALL_AUDIT_ROLES.has(role) ? getConfiguredAuditors(role) : [primaryRoute];
  if (!candidates.length) throw new Error('Nenhum provedor de IA está configurado para esta operação.');

  let lastError: Error | null = null;
  for (const route of candidates) {
    const provider = providers[route.providerName];
    if (!provider?.envKey) continue;

    const payload = normalizeAiPayload({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      temperature,
    }, route, role);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const startedAt = Date.now();

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${provider.envKey}`,
        'Content-Type': 'application/json',
      };
      if (route.providerName === 'openrouter') {
        headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || 'https://resumex.app';
        headers['X-OpenRouter-Title'] = process.env.OPENROUTER_APP_TITLE || 'ResumeX';
      }
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message || `${route.providerName} respondeu ${response.status}.`);
      const content = responseContent(result);
      if (!content) throw new Error(`${route.providerName} retornou conteúdo vazio.`);
      if (result?.choices?.[0]?.finish_reason === 'length') throw new Error(`${route.providerName} atingiu o limite de saída.`);
      logAiUsage({
        role,
        providerName: route.providerName,
        model: route.model,
        usage: result?.usage,
        finishReason: result?.choices?.[0]?.finish_reason || null,
        durationMs: Date.now() - startedAt,
      });
      return content;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error('Falha no provedor de IA.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  throw lastError || new Error('Nenhum provedor de IA está configurado para esta operação.');
}
