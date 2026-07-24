import { Request, Response, NextFunction, RequestHandler } from 'express';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  name: string;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const concurrentRequests = new Map<string, number>();

export function getClientId(req: Request): string {
  return req.authUser?.id || req.ip || req.socket.remoteAddress || 'unknown';
}

export function rateLimit({ windowMs, max, name }: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${name}:${getClientId(req)}`;
    const bucket = rateLimitBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;

    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({ error: { message: 'Rate limit exceeded.' } });
      return;
    }

    next();
  };
}

export function concurrencyLimit(max: number, name: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${getClientId(req)}`;
    const current = concurrentRequests.get(key) || 0;
    if (current >= max) {
      res.status(429).json({ error: { message: 'Too many concurrent requests.' } });
      return;
    }

    concurrentRequests.set(key, current + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (concurrentRequests.get(key) || 1) - 1;
      if (remaining > 0) concurrentRequests.set(key, remaining);
      else concurrentRequests.delete(key);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}
