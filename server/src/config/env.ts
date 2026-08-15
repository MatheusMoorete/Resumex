import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, '../../..');

export const port: number = Number(process.env.PORT || 8787);
export const isProduction: boolean = process.env.NODE_ENV === 'production';
export const allowedEmails: string[] = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const upstreamTimeoutMs: number = Number(process.env.AI_UPSTREAM_TIMEOUT_MS || 600000);
export const notionApiKey: string = process.env.NOTION_API_KEY || '';
export const notionParentPageId: string = process.env.NOTION_PARENT_PAGE_ID || '';
export const notionApiVersion: string = process.env.NOTION_API_VERSION || '2022-06-28';
export const e2eMockAuthEnabled: boolean = process.env.E2E_MOCK_AUTH === 'true';
export const e2eNotionMockEnabled: boolean = process.env.E2E_NOTION_MOCK === 'true';
export const e2eNotionMockPath: string = path.join(rootDir, 'tmp', 'notion-export-mock.json');
export const summaryPipelinePersistenceEnabled: boolean = process.env.SUMMARY_PIPELINE_PERSISTENCE_ENABLED === 'true';

export function getProviderKey(primaryName: string, legacyName: string): string {
  if (process.env[primaryName]) return process.env[primaryName]!;
  if (!isProduction && process.env[legacyName]) return process.env[legacyName]!;
  return '';
}

export interface ProviderConfig {
  baseUrl: string;
  envKey: string;
}

export const providers: Record<string, ProviderConfig> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    envKey: getProviderKey('DEEPSEEK_API_KEY', 'VITE_DEEPSEEK_API_KEY'),
  },
  zhipu: {
    baseUrl: 'https://api.z.ai/api/paas/v4',
    envKey: getProviderKey('ZHIPU_API_KEY', 'VITE_ZHIPU_API_KEY'),
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    envKey: getProviderKey('OPENAI_API_KEY', 'VITE_OPENAI_API_KEY'),
  },
  kimi: {
    baseUrl: 'https://api.moonshot.ai/v1',
    envKey: getProviderKey('KIMI_API_KEY', 'VITE_KIMI_API_KEY'),
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: getProviderKey('OPENROUTER_API_KEY', 'VITE_OPENROUTER_API_KEY'),
  },
};

export const aiModels = {
  zhipuVision: process.env.ZHIPU_VISION_MODEL || 'glm-4.5v',
  deepseekFlash: process.env.DEEPSEEK_FLASH_MODEL || 'deepseek-v4-flash',
  deepseekPro: process.env.DEEPSEEK_PRO_MODEL || 'deepseek-v4-pro',
  openaiAudit: process.env.OPENAI_AUDIT_MODEL || 'gpt-5.6-terra',
  kimiAudit: process.env.KIMI_AUDIT_MODEL || 'kimi-k3',
  openrouterAudit: process.env.OPENROUTER_AUDIT_MODEL || 'moonshotai/kimi-k3',
  openrouterCriticalAudit: process.env.OPENROUTER_CRITICAL_AUDIT_MODEL || 'openai/gpt-5.6-terra-pro',
};

export const gptAuditorEnabled: boolean = String(process.env.AI_ENABLE_GPT_AUDITOR || 'false').trim().toLowerCase() === 'true';
