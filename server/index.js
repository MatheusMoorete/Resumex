import 'dotenv/config';
import express from 'express';
import { clerkClient, clerkMiddleware, getAuth } from '@clerk/express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === 'production';
const clerkSecretKey = process.env.CLERK_SECRET_KEY || '';
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || '';
const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const upstreamTimeoutMs = Number(process.env.AI_UPSTREAM_TIMEOUT_MS || 600000);

if (isProduction && !clerkSecretKey) {
  console.error('Missing CLERK_SECRET_KEY. Refusing to start production without Clerk authentication.');
  process.exit(1);
}

if (isProduction && !clerkPublishableKey) {
  console.error('Missing CLERK_PUBLISHABLE_KEY. Refusing to start production without Clerk authentication.');
  process.exit(1);
}

if (isProduction && allowedEmails.length === 0) {
  console.error('Missing ALLOWED_EMAILS. Refusing to start production without an email allowlist.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '35mb' }));
app.use(clerkMiddleware({ publishableKey: clerkPublishableKey, secretKey: clerkSecretKey }));

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: { message: 'Invalid JSON payload.' } });
    return;
  }

  res.status(500).json({
    error: {
      message: error instanceof Error ? error.message : 'Internal server error.',
    },
  });
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const rateLimitBuckets = new Map();

function getClientId(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max, name }) {
  return (req, res, next) => {
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

async function requireAuth(req, res, next) {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      res.status(401).json({ error: { message: 'Authentication required.' } });
      return;
    }

    if (allowedEmails.length > 0) {
      const user = await clerkClient.users.getUser(userId);
      const emails = user.emailAddresses.map((email) => email.emailAddress.toLowerCase());
      const allowed = emails.some((email) => allowedEmails.includes(email));

      if (!allowed) {
        res.status(403).json({ error: { message: 'Email is not allowed.' } });
        return;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

function getProviderKey(primaryName, legacyName) {
  if (process.env[primaryName]) return process.env[primaryName];
  if (!isProduction && process.env[legacyName]) return process.env[legacyName];
  return '';
}

const providers = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    envKey: getProviderKey('DEEPSEEK_API_KEY', 'VITE_DEEPSEEK_API_KEY'),
  },
  zhipu: {
    baseUrl: 'https://api.z.ai/api/paas/v4',
    envKey: getProviderKey('ZHIPU_API_KEY', 'VITE_ZHIPU_API_KEY'),
  },
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const { userId } = getAuth(req);
  res.json({
    authRequired: true,
    authenticated: Boolean(userId),
  });
});

app.post('/api/auth/login', (_req, res) => {
  res.status(410).json({ error: { message: 'Password login was removed. Use Google sign-in.' } });
});

app.post('/api/auth/logout', (_req, res) => {
  res.status(410).json({ error: { message: 'Logout is handled by Clerk.' } });
});

app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    deepseekConfigured: Boolean(providers.deepseek.envKey),
    zhipuConfigured: Boolean(providers.zhipu.envKey),
  });
});

app.post(
  '/api/:provider/*path',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 80, name: 'ai-proxy' }),
  async (req, res) => {
  const provider = providers[req.params.provider];

  if (!provider) {
    res.status(404).json({ error: { message: 'Provider not found.' } });
    return;
  }

  const upstreamPath = Array.isArray(req.params.path)
    ? req.params.path.join('/')
    : req.params.path;
  const upstreamUrl = `${provider.baseUrl}/${upstreamPath}`;
  const providerAuth = req.get('x-provider-authorization');
  const authorization = providerAuth || (provider.envKey ? `Bearer ${provider.envKey}` : '');

  if (!authorization) {
    res.status(401).json({ error: { message: `Missing API key for ${req.params.provider}.` } });
    return;
  }

  if (!req.body || typeof req.body !== 'object' || !Array.isArray(req.body.messages)) {
    res.status(400).json({ error: { message: 'Invalid chat completion payload.' } });
    return;
  }

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), upstreamTimeoutMs);
    let upstreamResponse;
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
});

app.use(express.static(path.join(rootDir, 'dist')));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(rootDir, 'dist', 'index.html'));
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => {
    if (allowedEmails.length === 0) {
      console.warn('ALLOWED_EMAILS is not configured. Any authenticated Clerk user can use the app.');
    }
    console.log(`ResumeX server listening on http://localhost:${port}`);
  });
}

export default app;
