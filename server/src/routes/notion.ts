import { Router, Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from '../middlewares/auth.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { canUseLocalE2EMock } from '../middlewares/security.js';
import { e2eNotionMockEnabled, e2eNotionMockPath, notionApiKey, notionApiVersion, notionParentPageId } from '../config/env.js';
import { notionExportSchema } from '../schemas/notionSchema.js';

export function normalizeNotionPageId(pageId: string): string {
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

export function chunkText(text: string, maxLength: number = 1900): string[] {
  const chunks: string[] = [];
  const value = String(text || '');

  for (let index = 0; index < value.length; index += maxLength) {
    chunks.push(value.slice(index, index + maxLength));
  }

  return chunks.length > 0 ? chunks : [''];
}

export function richTextObject(content: string, annotations: Record<string, any> = {}, url: string | null = null): any {
  const text: any = { content };
  if (url) text.link = { url };

  const object: any = {
    type: 'text',
    text,
  };
  if (Object.keys(annotations).length > 0) object.annotations = annotations;
  return object;
}

export function richText(text: string): any[] {
  return chunkText(text).map((content) => richTextObject(content));
}

export function richTextFromMarkdown(text: string): any[] {
  const source = String(text || '');
  const tokens: any[] = [];
  let cursor = 0;
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;

  const pushPlain = (value: string) => {
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

export function plainBlock(type: string, text: string): any {
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: richTextFromMarkdown(text),
    },
  };
}

export function parseMarkdownTable(lines: string[], startIndex: number): { text: string; nextIndex: number } | null {
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

export function markdownToNotionBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

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

export function getNotionTitle(markdown: string, fallbackTitle?: string): string {
  const firstHeading = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => /^#\s+(.+)$/.exec(line.trim()))
    .find(Boolean);

  const title = firstHeading?.[1] || fallbackTitle || 'Resumo ResumeX';
  return title.slice(0, 120);
}

export async function notionRequest(pathname: string, options: RequestInit): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Content-Type': 'application/json',
      'Notion-Version': notionApiVersion,
      ...(options.headers || {}),
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

const router = Router();

router.post(
  '/export',
  requireAuth,
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, name: 'notion-export' }),
  async (req: Request, res: Response) => {
    try {
      const parsed = notionExportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: parsed.error.issues[0]?.message || 'Resumo vazio.' } });
        return;
      }

      const { markdown, title: bodyTitle } = parsed.data;
      const title = getNotionTitle(markdown, bodyTitle);
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

export default router;
