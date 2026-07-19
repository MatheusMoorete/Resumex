import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAuthProvider } from './auth/authProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === 'production';
const authProvider = createAuthProvider();
const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const upstreamTimeoutMs = Number(process.env.AI_UPSTREAM_TIMEOUT_MS || 600000);
const notionApiKey = process.env.NOTION_API_KEY || '';
const notionParentPageId = process.env.NOTION_PARENT_PAGE_ID || '';
const notionApiVersion = process.env.NOTION_API_VERSION || '2022-06-28';
const e2eMockAuthEnabled = process.env.E2E_MOCK_AUTH === 'true';
const e2eNotionMockEnabled = process.env.E2E_NOTION_MOCK === 'true';
const e2eNotionMockPath = path.join(rootDir, 'tmp', 'notion-export-mock.json');

if (isProduction && !authProvider.isConfigured) {
  console.error(`Authentication provider "${authProvider.name}" is not configured. Refusing to start production.`);
  process.exit(1);
}

if (isProduction && allowedEmails.length === 0) {
  console.error('Missing ALLOWED_EMAILS. Refusing to start production without an email allowlist.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '35mb' }));

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

function isLocalAddress(value) {
  const address = String(value || '').toLowerCase();
  return [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'localhost',
  ].includes(address);
}

function isLocalRequest(req) {
  const host = String(req.get('host') || '').split(':')[0].toLowerCase();
  return isLocalAddress(host) || isLocalAddress(req.socket.remoteAddress);
}

function canUseLocalE2EMock(req) {
  return !isProduction && isLocalRequest(req);
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

function getBearerToken(req) {
  const authorization = String(req.get('authorization') || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);
  return authProvider.verifyToken(token);
}

async function requireAuth(req, res, next) {
  try {
    if (e2eMockAuthEnabled && canUseLocalE2EMock(req)) {
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

app.get('/api/auth/status', async (req, res, next) => {
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

app.post('/api/auth/login', (_req, res) => {
  res.status(410).json({ error: { message: 'Password login was removed. Use Google sign-in.' } });
});

app.post('/api/auth/logout', (_req, res) => {
  res.status(410).json({ error: { message: 'Logout is handled by the authentication provider.' } });
});

app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    deepseekConfigured: Boolean(providers.deepseek.envKey),
    zhipuConfigured: Boolean(providers.zhipu.envKey),
    notionConfigured: Boolean(notionApiKey && notionParentPageId),
  });
});

function normalizeNotionPageId(pageId) {
  const cleaned = String(pageId || '').replace(/-/g, '').trim();
  if (!/^[0-9a-fA-F]{32}$/.test(cleaned)) return String(pageId || '').trim();
  return [
    cleaned.slice(0, 8),
    cleaned.slice(8, 12),
    cleaned.slice(12, 16),
    cleaned.slice(16, 20),
    cleaned.slice(20),
  ].join('-');
}

function chunkText(text, maxLength = 1900) {
  const chunks = [];
  const value = String(text || '');

  for (let index = 0; index < value.length; index += maxLength) {
    chunks.push(value.slice(index, index + maxLength));
  }

  return chunks.length > 0 ? chunks : [''];
}

function richTextObject(content, annotations = {}, url = null) {
  const text = { content };
  if (url) text.link = { url };

  const object = {
    type: 'text',
    text,
  };
  if (Object.keys(annotations).length > 0) object.annotations = annotations;
  return object;
}

function richText(text) {
  return chunkText(text).map((content) => richTextObject(content));
}

function richTextFromMarkdown(text) {
  const source = String(text || '');
  const tokens = [];
  let cursor = 0;
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match;

  const pushPlain = (value) => {
    if (value) tokens.push({ text: value });
  };

  while ((match = pattern.exec(source)) !== null) {
    pushPlain(source.slice(cursor, match.index));

    if (match[1]) {
      tokens.push({ text: match[1], annotations: { code: true } });
    } else if (match[2] || match[3]) {
      tokens.push({ text: match[2] || match[3], annotations: { bold: true } });
    } else if (match[4] || match[5]) {
      tokens.push({ text: match[4] || match[5], annotations: { italic: true } });
    } else if (match[6] && match[7]) {
      tokens.push({ text: match[6], url: match[7] });
    }

    cursor = pattern.lastIndex;
  }

  pushPlain(source.slice(cursor));

  return tokens.flatMap((token) => (
    chunkText(token.text).map((content) => richTextObject(content, token.annotations || {}, token.url || null))
  ));
}

function plainBlock(type, text) {
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: richTextFromMarkdown(text),
    },
  };
}

function parseMarkdownTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length) return null;

  const headerLine = lines[startIndex].trim();
  const separatorLine = lines[startIndex + 1].trim();
  const isSeparator = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separatorLine);

  if (!headerLine.includes('|') || !isSeparator) return null;

  const tableLines = [headerLine];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim().includes('|') && lines[index].trim() !== '') {
    tableLines.push(lines[index].trim());
    index += 1;
  }

  return {
    text: tableLines.join('\n'),
    nextIndex: index,
  };
}

function markdownToNotionBlocks(markdown) {
  const blocks = [];
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let paragraph = [];
  let inCodeBlock = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(plainBlock('paragraph', paragraph.join('\n').trim()));
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({
          object: 'block',
          type: 'code',
          code: {
            rich_text: richText(codeLines.join('\n')),
            language: 'plain text',
          },
        });
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushParagraph();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const table = parseMarkdownTable(lines, index);
    if (table) {
      flushParagraph();
      blocks.push(plainBlock('paragraph', table.text));
      index = table.nextIndex - 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const type = `heading_${heading[1].length}`;
      blocks.push(plainBlock(type, heading[2].replace(/\s+#+$/, '')));
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      blocks.push(plainBlock('bulleted_list_item', unordered[1]));
      continue;
    }

    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      blocks.push(plainBlock('numbered_list_item', ordered[1]));
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      blocks.push(plainBlock('quote', quote[1]));
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }

    paragraph.push(line);
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        rich_text: richText(codeLines.join('\n')),
        language: 'plain text',
      },
    });
  }

  flushParagraph();
  return blocks.length > 0 ? blocks : [plainBlock('paragraph', 'Resumo vazio.')];
}

function getNotionTitle(markdown, fallbackTitle) {
  const firstHeading = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => /^#\s+(.+)$/.exec(line.trim()))
    .find(Boolean);

  const title = firstHeading?.[1] || fallbackTitle || 'Resumo ResumeX';
  return title.slice(0, 120);
}

async function notionRequest(pathname, options) {
  const response = await fetch(`https://api.notion.com/v1${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': notionApiVersion,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed.message || parsed.error || body;
    } catch {
      // Keep raw body.
    }
    throw new Error(message || `Notion API error ${response.status}`);
  }

  return response.json();
}

app.post(
  '/api/notion/export',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, name: 'notion-export' }),
  async (req, res) => {
    try {
      const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown.trim() : '';
      if (!markdown) {
        res.status(400).json({ error: { message: 'Resumo vazio.' } });
        return;
      }

      const title = getNotionTitle(markdown, req.body?.title);
      const blocks = markdownToNotionBlocks(markdown);

      if (e2eNotionMockEnabled && canUseLocalE2EMock(req)) {
        await fs.mkdir(path.dirname(e2eNotionMockPath), { recursive: true });
        await fs.writeFile(
          e2eNotionMockPath,
          JSON.stringify({
            mode: 'mock',
            exportedAt: new Date().toISOString(),
            title,
            blockCount: blocks.length,
            blocks,
          }, null, 2)
        );

        res.json({
          id: 'mock-notion-page',
          url: 'https://notion.so/mock-resumex-e2e',
          title,
          mock: true,
          savedTo: e2eNotionMockPath,
        });
        return;
      }

      if (!notionApiKey || !notionParentPageId) {
        res.status(503).json({
          error: {
            message: 'Notion nao esta configurado no servidor. Defina NOTION_API_KEY e NOTION_PARENT_PAGE_ID.',
          },
        });
        return;
      }

      const page = await notionRequest('/pages', {
        method: 'POST',
        body: JSON.stringify({
          parent: {
            type: 'page_id',
            page_id: normalizeNotionPageId(notionParentPageId),
          },
          properties: {
            title: {
              title: richText(title),
            },
          },
        }),
      });

      for (let index = 0; index < blocks.length; index += 100) {
        await notionRequest(`/blocks/${page.id}/children`, {
          method: 'PATCH',
          body: JSON.stringify({
            children: blocks.slice(index, index + 100),
          }),
        });
      }

      res.json({
        id: page.id,
        url: page.url,
        title,
      });
    } catch (error) {
      res.status(502).json({
        error: {
          message: error instanceof Error ? error.message : 'Notion export failed.',
        },
      });
    }
  }
);

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
      console.warn('ALLOWED_EMAILS is not configured. Any authenticated user can use the app.');
    }
    console.log(`ResumeX server listening on http://localhost:${port}`);
  });
}

export default app;
