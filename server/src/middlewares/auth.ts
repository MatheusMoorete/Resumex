import { Request, Response, NextFunction } from 'express';
import { createAuthProvider, AuthUser } from '../../auth/authProvider.js';
import { allowedEmails, e2eMockAuthEnabled } from '../config/env.js';
import { canUseLocalE2EMock } from './security.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export const authProvider = createAuthProvider();

export function getBearerToken(req: Request): string {
  const authorization = String(req.get('authorization') || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export async function getAuthenticatedUser(req: Request): Promise<AuthUser | null> {
  const token = getBearerToken(req);
  return authProvider.verifyToken(token);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (e2eMockAuthEnabled && canUseLocalE2EMock(req)) {
      req.authUser = { id: 'e2e-user', email: 'e2e@localhost' };
      next();
      return;
    }

    const user = await getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: { message: 'Authentication required.' } });
      return;
    }

    if (allowedEmails.length > 0) {
      const email = String(user.email || '').toLowerCase();
      const allowed = allowedEmails.includes(email);

      if (!allowed) {
        res.status(403).json({ error: { message: 'Email is not allowed.' } });
        return;
      }
    }

    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
