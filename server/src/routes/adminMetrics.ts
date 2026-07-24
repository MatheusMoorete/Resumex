import { Router, Request, Response } from 'express';
import { getAuthenticatedUser, requireAuth } from '../middlewares/auth.js';
import { allowedEmails } from '../config/env.js';
import { telemetry } from '../services/telemetry.js';

const router = Router();
const isDev = process.env.NODE_ENV !== 'production';

function isAuthorizedAdmin(req: Request): boolean {
  if (isDev) return true;
  if (allowedEmails.length === 0) return true;
  const userEmail = req.authUser?.email?.toLowerCase();
  return Boolean(userEmail && allowedEmails.includes(userEmail));
}

const optionalAuthInDev = async (req: Request, res: Response, next: any) => {
  if (isDev) {
    try {
      const user = await getAuthenticatedUser(req);
      if (user) req.authUser = user;
    } catch {}
    next();
    return;
  }
  return requireAuth(req, res, next);
};

router.get('/admin/metrics', optionalAuthInDev, (req: Request, res: Response): void => {
  if (!isAuthorizedAdmin(req)) {
    res.status(403).json({ error: { message: 'Acesso restrito a administradores.' } });
    return;
  }

  const metrics = telemetry.getSummaryMetrics();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    metrics,
  });
});

router.post('/admin/metrics/reset', optionalAuthInDev, (req: Request, res: Response): void => {
  if (!isAuthorizedAdmin(req)) {
    res.status(403).json({ error: { message: 'Acesso restrito a administradores.' } });
    return;
  }

  telemetry.resetMetrics();
  res.json({ status: 'ok', message: 'Métricas de telemetria reiniciadas com sucesso.' });
});

export default router;
