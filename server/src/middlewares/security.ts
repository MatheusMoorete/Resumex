import { Request, Response, NextFunction } from 'express';
import { isProduction } from '../config/env.js';

export function jsonErrorHandler(error: any, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: { message: 'Invalid JSON payload.' } });
    return;
  }

  res.status(500).json({
    error: {
      message: error instanceof Error ? error.message : 'Internal server error.',
    },
  });
}

export function securityHeadersHandler(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function isLocalAddress(value: string | undefined): boolean {
  const address = String(value || '').toLowerCase();
  return [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'localhost',
  ].includes(address);
}

export function isLocalRequest(req: Request): boolean {
  return isLocalAddress(req.socket.remoteAddress);
}

export function canUseLocalE2EMock(req: Request): boolean {
  return !isProduction && isLocalRequest(req);
}
