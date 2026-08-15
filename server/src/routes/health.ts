import { Router, Request, Response, NextFunction } from 'express';
import { getAuthenticatedUser, requireAuth } from '../middlewares/auth.js';
import { aiModels, gptAuditorEnabled, providers } from '../config/env.js';
import { getConfiguredAuditor, CRITICAL_AUDIT_ROLES, SIMPLE_AUDIT_ROLES, AUDIT_ROLES } from './aiProxy.js';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

router.get('/auth/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getAuthenticatedUser(req);
    res.json({
      authRequired: true,
      authenticated: Boolean(user),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/login', (_req: Request, res: Response) => {
  res.status(410).json({ error: { message: 'Password login was removed. Use Google sign-in.' } });
});

router.post('/auth/logout', (_req: Request, res: Response) => {
  res.status(410).json({ error: { message: 'Logout is handled by the authentication provider.' } });
});

router.get('/config', requireAuth, (_req: Request, res: Response) => {
  const auditor = getConfiguredAuditor();
  const criticalAuditor = getConfiguredAuditor('quiz-audit-critical');
  const notionApiKey = process.env.NOTION_API_KEY || '';
  const notionParentPageId = process.env.NOTION_PARENT_PAGE_ID || '';

  res.json({
    deepseekConfigured: Boolean(providers.deepseek?.envKey),
    zhipuConfigured: Boolean(providers.zhipu?.envKey),
    kimiConfigured: Boolean(providers.kimi?.envKey || providers.openrouter?.envKey),
    auditorConfigured: Boolean(auditor),
    auditorProvider: auditor?.providerName || null,
    gptAuditorEnabled,
    models: {
      localPdfExtraction: {
        provider: 'local',
        model: 'PyMuPDF',
        roles: ['pdf-text-extraction'],
      },
      fastText: {
        provider: 'deepseek',
        model: aiModels.deepseekFlash,
        roles: ['summary-spec', 'quiz-extract', 'flashcard-generate'],
      },
      generation: {
        provider: 'deepseek',
        model: aiModels.deepseekPro,
        roles: ['summary', 'quiz-generate', 'flashcard-generate-complex'],
      },
      simpleAudit: {
        provider: 'deepseek',
        model: aiModels.deepseekFlash,
        roles: [...SIMPLE_AUDIT_ROLES],
      },
      routineAudit: {
        provider: auditor?.providerName || null,
        model: auditor?.model || null,
        roles: [...AUDIT_ROLES],
      },
      criticalAudit: {
        provider: criticalAuditor?.providerName || null,
        model: criticalAuditor?.model || null,
        roles: [...CRITICAL_AUDIT_ROLES],
      },
      vision: {
        provider: 'zhipu',
        model: 'glm-4.5v',
        roles: ['visual-transcription'],
      },
    },
    notionConfigured: Boolean(notionApiKey && notionParentPageId),
  });
});

export default router;
