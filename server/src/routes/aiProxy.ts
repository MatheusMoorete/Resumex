import { Router, Request, Response } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { concurrencyLimit, rateLimit } from '../middlewares/rateLimit.js';
import { aiModels, gptAuditorEnabled, providers, upstreamTimeoutMs } from '../config/env.js';

export interface AiRoute {
  providerName: string;
  model: string;
}

export interface LogAiUsageParams {
  role: string;
  providerName: string;
  model: string;
  usage: any;
  finishReason: string | null;
  durationMs: number;
}

export const GENERATION_ROLES = new Set([
  'vision',
  'quiz-extract',
  'quiz-generate',
  'flashcard-generate',
  'flashcard-generate-complex',
]);

export const AUDIT_ROLES = new Set(['quiz-audit']);
export const CRITICAL_AUDIT_ROLES = new Set(['quiz-audit-critical']);
export const SIMPLE_AUDIT_ROLES = new Set(['quiz-audit-simple']);
export const ALL_AUDIT_ROLES = new Set([...AUDIT_ROLES, ...CRITICAL_AUDIT_ROLES]);
export const FAST_ROLES = new Set([
  'quiz-extract',
  'flashcard-generate',
  ...SIMPLE_AUDIT_ROLES,
]);
export const ALLOWED_AI_ROLES = new Set([...GENERATION_ROLES, ...ALL_AUDIT_ROLES, ...SIMPLE_AUDIT_ROLES]);
export const PUBLIC_AI_ROLES = new Set<string>();

const MAX_INPUT_CHARS_BY_ROLE: Record<string, number> = {
  vision: 6_000_000,
  'quiz-extract': 400_000,
  'quiz-generate': 400_000,
  'quiz-audit': 400_000,
  'quiz-audit-simple': 400_000,
  'quiz-audit-critical': 400_000,
  'flashcard-generate': 600_000,
  'flashcard-generate-complex': 600_000,
};

function sanitizeMessage(message: any) {
  if (!message || !['system', 'user', 'assistant'].includes(message.role)) {
    throw new Error('Invalid AI message role.');
  }
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }
  if (!Array.isArray(message.content)) throw new Error('Invalid AI message content.');
  return {
    role: message.role,
    content: message.content.map((item: any) => {
      if (item?.type === 'text' && typeof item.text === 'string') {
        return { type: 'text', text: item.text };
      }
      if (item?.type === 'image_url' && typeof item.image_url?.url === 'string') {
        return { type: 'image_url', image_url: { url: item.image_url.url } };
      }
      throw new Error('Unsupported AI message content.');
    }),
  };
}

export function sanitizeAiMessages(role: string, messages: any[]) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 8) {
    throw new Error('AI requests must contain between 1 and 8 messages.');
  }
  const sanitized = messages.map(sanitizeMessage);
  const inputChars = sanitized.reduce((total, message) => (
    total + (typeof message.content === 'string'
      ? message.content.length
      : JSON.stringify(message.content).length)
  ), 0);
  const maxInputChars = MAX_INPUT_CHARS_BY_ROLE[role] || 200_000;
  if (inputChars > maxInputChars) {
    throw new Error(`AI input exceeds the ${maxInputChars} character limit for role ${role}.`);
  }
  return sanitized;
}

export function getConfiguredAuditors(role: string = 'quiz-audit'): AiRoute[] {
  const requested = String(process.env.AI_PRIMARY_AUDITOR || 'openrouter').trim().toLowerCase();
  const isCritical = CRITICAL_AUDIT_ROLES.has(role);

  if (isCritical) {
    const routes: AiRoute[] = [];
    if (gptAuditorEnabled && providers.openrouter?.envKey) {
      routes.push({ providerName: 'openrouter', model: aiModels.openrouterCriticalAudit });
    }
    if (gptAuditorEnabled && providers.openai?.envKey) {
      routes.push({ providerName: 'openai', model: aiModels.openaiAudit });
    }
    if (providers.openrouter?.envKey) {
      routes.push({ providerName: 'openrouter', model: aiModels.openrouterAudit });
    }
    if (providers.kimi?.envKey) {
      routes.push({ providerName: 'kimi', model: aiModels.kimiAudit });
    }
    return routes;
  }

  const providerOrder = requested === 'openai'
    ? ['openai', 'openrouter', 'kimi']
    : requested === 'kimi'
      ? ['kimi', 'openrouter', 'openai']
      : ['openrouter', 'kimi', 'openai'];

  return providerOrder.flatMap((providerName) => {
    if (!providers[providerName]?.envKey) return [];
    if (providerName === 'openai' && !gptAuditorEnabled) return [];
    if (providerName === 'openrouter') {
      return [{ providerName, model: aiModels.openrouterAudit }];
    }
    return [{
      providerName,
      model: providerName === 'kimi' ? aiModels.kimiAudit : aiModels.openaiAudit,
    }];
  });
}

export function getConfiguredAuditor(role?: string): AiRoute | null {
  return getConfiguredAuditors(role)[0] || null;
}

export function resolveAiRoute(role: string): AiRoute | null {
  if (!ALLOWED_AI_ROLES.has(role)) return null;

  if (role === 'vision') {
    return { providerName: 'zhipu', model: aiModels.zhipuVision };
  }

  if (ALL_AUDIT_ROLES.has(role)) {
    return getConfiguredAuditor(role);
  }

  if (role === 'flashcard-generate-complex') {
    return { providerName: 'deepseek', model: aiModels.deepseekPro };
  }

  return {
    providerName: 'deepseek',
    model: FAST_ROLES.has(role) ? aiModels.deepseekFlash : aiModels.deepseekPro,
  };
}

export function normalizeAiPayload(body: any, route: AiRoute, role: string): any {
  const maxTokensByRole: Record<string, number> = {
    vision: 4096,
    'quiz-extract': 8192,
    'quiz-generate': 8192,
    'quiz-audit': 8192,
    'quiz-audit-simple': 6144,
    'quiz-audit-critical': 8192,
    'flashcard-generate': 8192,
    'flashcard-generate-complex': 8192,
  };
  const requestedMax = Number(body.max_tokens || body.max_completion_tokens || 0);
  const roleMax = maxTokensByRole[role] || 16000;
  const maxTokens = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.max(1, Math.min(requestedMax, roleMax))
    : roleMax;
  const requestedTemperature = Number(body.temperature ?? 0.1);
  const payload: any = {
    model: route.model,
    messages: sanitizeAiMessages(role, body.messages),
    stream: body.stream === true,
    temperature: Number.isFinite(requestedTemperature)
      ? Math.max(0, Math.min(requestedTemperature, 0.5))
      : 0.1,
  };
  if (body.response_format?.type === 'json_object') {
    payload.response_format = { type: 'json_object' };
  }

  if (role.startsWith('quiz-audit') && route.providerName !== 'deepseek') {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'quiz_audit',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  approved: { type: 'boolean' },
                  score: { type: 'number', minimum: 0, maximum: 100 },
                  issue: { type: 'string' },
                  topic: { type: 'string' },
                },
                required: ['id', 'approved', 'score', 'issue', 'topic'],
                additionalProperties: false,
              },
            },
          },
          required: ['items'],
          additionalProperties: false,
        },
      },
    };
  }

  if (route.providerName === 'kimi') {
    delete payload.max_tokens;
    delete payload.temperature;
    delete payload.top_p;
    delete payload.thinking;
    payload.max_completion_tokens = maxTokens;
    payload.reasoning_effort = CRITICAL_AUDIT_ROLES.has(role) ? 'high' : 'medium';
  } else if (route.providerName === 'openai') {
    delete payload.max_tokens;
    delete payload.temperature;
    delete payload.top_p;
    payload.max_completion_tokens = maxTokens;
    payload.reasoning_effort = role.includes('audit') ? 'medium' : 'low';
  } else if (route.providerName === 'openrouter') {
    delete payload.max_completion_tokens;
    delete payload.temperature;
    delete payload.top_p;
    delete payload.thinking;
    payload.max_tokens = maxTokens;
    if (route.model.includes('kimi-k3')) {
      payload.reasoning_effort = CRITICAL_AUDIT_ROLES.has(role) ? 'high' : 'medium';
    }
  } else if (route.providerName === 'zhipu') {
    delete payload.max_completion_tokens;
    payload.max_tokens = maxTokens;
  } else {
    delete payload.max_completion_tokens;
    payload.max_tokens = maxTokens;
    if (SIMPLE_AUDIT_ROLES.has(role) || role.startsWith('flashcard-')) {
      payload.thinking = { type: 'disabled' };
      delete payload.reasoning_effort;
    } else {
      payload.thinking = { type: 'enabled' };
      payload.reasoning_effort = role === 'quiz-generate'
        ? 'max'
        : 'high';
    }
    if (payload.stream) {
      payload.stream_options = { ...(payload.stream_options || {}), include_usage: true };
    }
  }

  return payload;
}

import { telemetry } from '../services/telemetry.js';

export function logAiUsage({ role, providerName, model, usage, finishReason, durationMs }: LogAiUsageParams): void {
  const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const cachedTokens = usage?.prompt_cache_hit_tokens ?? usage?.cached_tokens ?? 0;

  const record = telemetry.recordUsage({
    role,
    provider: providerName,
    model,
    promptTokens,
    completionTokens,
    cachedTokens,
    durationMs,
    finishReason: finishReason || undefined,
  });

  console.info(JSON.stringify({
    event: 'ai_usage',
    role,
    provider: providerName,
    model,
    promptTokens,
    completionTokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens
      ?? usage?.output_tokens_details?.reasoning_tokens
      ?? null,
    cachedTokens,
    costUsd: record.costUsd,
    flowType: record.flowType,
    finishReason: finishReason || null,
    durationMs,
  }));
}

const router = Router();

router.post(
  '/ai/chat/completions',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 60, name: 'ai-orchestrator' }),
  concurrencyLimit(2, 'ai-orchestrator'),
  async (req: Request, res: Response) => {
    const role = String(req.body?.role || '').trim();
    const providerAuth = req.get('x-provider-authorization');
    if (!PUBLIC_AI_ROLES.has(role)) {
      res.status(400).json({ error: { message: `Role is not available through the public AI proxy: ${role || 'missing'}.` } });
      return;
    }
    const primaryRoute = resolveAiRoute(role);

    if (!primaryRoute) {
      if (ALL_AUDIT_ROLES.has(role)) {
        res.status(503).json({
          error: {
            message: 'Independent audit is not configured. Set OPENROUTER_API_KEY, KIMI_API_KEY or OPENAI_API_KEY.',
          },
        });
        return;
      }
      res.status(400).json({ error: { message: `Unknown AI role: ${role || 'missing'}.` } });
      return;
    }

    try {
      sanitizeAiMessages(role, req.body?.messages);
    } catch (error) {
      res.status(413).json({
        error: { message: error instanceof Error ? error.message : 'Invalid chat completion payload.' },
      });
      return;
    }

    const { role: _role, ...clientBody } = req.body;
    const startedAt = Date.now();

    try {
      const routeCandidates = ALL_AUDIT_ROLES.has(role) ? getConfiguredAuditors(role) : [primaryRoute];
      let route = primaryRoute;
      let payload: any;
      let upstreamResponse: Response | any;

      for (let index = 0; index < routeCandidates.length; index += 1) {
        route = routeCandidates[index];
        const provider = providers[route.providerName];
        const authorization = ['deepseek', 'zhipu'].includes(route.providerName) && providerAuth
          ? providerAuth
          : provider?.envKey
            ? `Bearer ${provider.envKey}`
            : '';

        if (!authorization) {
          if (index < routeCandidates.length - 1) continue;
          throw new Error(`Missing API key for ${route.providerName}.`);
        }

        payload = normalizeAiPayload(clientBody, route, role);
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), upstreamTimeoutMs);
        try {
          const upstreamHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept-Language': req.get('accept-language') || 'en-US,en',
            Authorization: authorization,
          };
          if (route.providerName === 'openrouter') {
            upstreamHeaders['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || 'https://resumex.app';
            upstreamHeaders['X-OpenRouter-Title'] = process.env.OPENROUTER_APP_TITLE || 'ResumeX';
          }

          upstreamResponse = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: upstreamHeaders,
            body: JSON.stringify(payload),
            signal: abortController.signal,
          });
        } catch (error) {
          if (index >= routeCandidates.length - 1) throw error;
          console.warn(JSON.stringify({
            event: 'ai_provider_fallback',
            role,
            failedProvider: route.providerName,
            failedModel: route.model,
            reason: error instanceof Error ? error.message : 'request_failed',
          }));
          continue;
        } finally {
          clearTimeout(timeout);
        }

        if (upstreamResponse.ok || index >= routeCandidates.length - 1) break;

        console.warn(JSON.stringify({
          event: 'ai_provider_fallback',
          role,
          failedProvider: route.providerName,
          failedModel: route.model,
          status: upstreamResponse.status,
        }));
        await upstreamResponse.body?.cancel();
      }

      if (!upstreamResponse || !payload) throw new Error('No configured AI provider was available.');

      res.status(upstreamResponse.status);
      res.setHeader('X-AI-Provider', route.providerName);
      res.setHeader('X-AI-Model', route.model);
      res.setHeader('X-AI-Role', role);
      const contentType = upstreamResponse.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);

      if (!upstreamResponse.body) {
        res.end();
        return;
      }

      if (!payload.stream) {
        const responseText = await upstreamResponse.text();
        try {
          const parsed = JSON.parse(responseText);
          logAiUsage({
            role,
            providerName: route.providerName,
            model: route.model,
            usage: parsed.usage,
            finishReason: parsed.choices?.[0]?.finish_reason,
            durationMs: Date.now() - startedAt,
          });
        } catch {}
        res.send(responseText);
        return;
      }

      const reader = upstreamResponse.body.getReader();
      const decoder = new TextDecoder();
      let observationBuffer = '';
      let usage: any = null;
      let finishReason: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        observationBuffer += decoder.decode(value, { stream: true });
        const lines = observationBuffer.split('\n');
        observationBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            usage = parsed.usage || usage;
            finishReason = parsed.choices?.[0]?.finish_reason || finishReason;
          } catch {}
        }
      }

      logAiUsage({
        role,
        providerName: route.providerName,
        model: route.model,
        usage,
        finishReason,
        durationMs: Date.now() - startedAt,
      });
      res.end();
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(502).json({
        error: {
          message: error instanceof Error ? error.message : 'AI upstream request failed.',
        },
      });
    }
  }
);

router.post(
  '/:provider/*path',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 80, name: 'ai-proxy' }),
  async (req: Request, res: Response) => {
    const providerParam = (req.params as any).provider;
    const provider = providers[providerParam];

    if (!provider) {
      res.status(404).json({ error: { message: 'Provider not found.' } });
      return;
    }

    const rawPath = (req.params as any).path;
    const upstreamPath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;
    if (upstreamPath !== 'chat/completions') {
      res.status(404).json({ error: { message: 'Provider endpoint not allowed.' } });
      return;
    }
    const upstreamUrl = `${provider.baseUrl}/${upstreamPath}`;
    const providerAuth = req.get('x-provider-authorization');
    const authorization = providerAuth?.startsWith('Bearer ') && providerAuth.length > 7
      ? providerAuth
      : '';

    if (!authorization) {
      res.status(401).json({
        error: { message: 'The generic provider proxy is BYOK-only. Send X-Provider-Authorization.' },
      });
      return;
    }

    if (!req.body || typeof req.body !== 'object' || !Array.isArray(req.body.messages)) {
      res.status(400).json({ error: { message: 'Invalid chat completion payload.' } });
      return;
    }

    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), upstreamTimeoutMs);
      let upstreamResponse: Response | any;
      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': req.get('accept-language') || 'en-US,en',
            Authorization: authorization,
          },
          body: JSON.stringify(req.body),
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      res.status(upstreamResponse.status);
      const contentType = upstreamResponse.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);

      if (!upstreamResponse.body) {
        res.end();
        return;
      }

      const reader = upstreamResponse.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }

      res.end();
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }

      res.status(502).json({
        error: {
          message: error instanceof Error ? error.message : 'Upstream request failed.',
        },
      });
    }
  }
);

export default router;
