import { buildAuthHeaders } from '../../auth/services/authClient';
import { stripPageReferences } from '../../../shared/utils/clipboard';

export interface SavedSummary {
  id: string;
  user_id?: string;
  title: string;
  content: string;
  template_type: string;
  source_file_name?: string;
  content_hash?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SummaryDraft {
  title: string;
  content: string;
  template_type?: string;
  source_file_name?: string;
  content_hash?: string;
  tags?: string[];
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const isMock = !supabaseUrl || !supabaseKey || (import.meta.env.DEV && import.meta.env.VITE_E2E_MOCK === 'true');
const mockSummariesKey = 'resumex_mock_summaries';

function readMock(): SavedSummary[] {
  try {
    return JSON.parse(localStorage.getItem(mockSummariesKey) || '[]');
  } catch {
    return [];
  }
}

function writeMock(items: SavedSummary[]) {
  localStorage.setItem(mockSummariesKey, JSON.stringify(items));
}

async function request(path: string, options: RequestInit = {}) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase não está configurado.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      'Content-Type': 'application/json',
      ...await buildAuthHeaders(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || payload?.hint || 'Erro ao comunicar com a base de resumos.');
  }

  if (response.status === 204) return null;
  return response.json();
}

function saveLocalSummary(draft: SummaryDraft): SavedSummary {
  const timestamp = new Date().toISOString();
  const title = draft.title.trim() || 'Resumo Sem Título';
  const template_type = draft.template_type || 'general';
  const content = stripPageReferences(draft.content);

  const newSummary: SavedSummary = {
    id: crypto.randomUUID(),
    title,
    content,
    template_type,
    source_file_name: draft.source_file_name || undefined,
    content_hash: draft.content_hash || undefined,
    tags: draft.tags || [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  const list = [newSummary, ...readMock().filter((s) => s.id !== newSummary.id)];
  writeMock(list);
  return newSummary;
}

export async function listSummaries(): Promise<SavedSummary[]> {
  const localItems = readMock();
  if (isMock) {
    return localItems.map((item) => ({ ...item, content: stripPageReferences(item.content) }));
  }
  try {
    const remoteItems: SavedSummary[] = await request('summaries?select=*&order=created_at.desc');
    if (Array.isArray(remoteItems)) {
      const remoteIds = new Set(remoteItems.map((item) => item.id));
      const combined = [...remoteItems, ...localItems.filter((item) => !remoteIds.has(item.id))];
      const sorted = combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return sorted.map((item) => ({ ...item, content: stripPageReferences(item.content) }));
    }
  } catch (err) {
    console.warn('[summaryApi] Supabase list failed, returning local storage items:', err);
  }
  return localItems.map((item) => ({ ...item, content: stripPageReferences(item.content) }));
}

export async function findSummaryByHash(contentHash: string): Promise<SavedSummary | null> {
  if (!contentHash) return null;
  const localList = readMock();
  const localMatch = localList.find((item) => item.content_hash === contentHash);
  if (localMatch) return { ...localMatch, content: stripPageReferences(localMatch.content) };

  if (!isMock) {
    try {
      const remoteMatch: SavedSummary[] = await request(`summaries?content_hash=eq.${encodeURIComponent(contentHash)}&limit=1`);
      if (Array.isArray(remoteMatch) && remoteMatch[0]) {
        return { ...remoteMatch[0], content: stripPageReferences(remoteMatch[0].content) };
      }
    } catch {
      // Fallback silently if query fails
    }
  }
  return null;
}

export async function createSummary(draft: SummaryDraft): Promise<SavedSummary> {
  const cleanDraft: SummaryDraft = {
    ...draft,
    content: stripPageReferences(draft.content),
  };

  if (isMock) {
    return saveLocalSummary(cleanDraft);
  }

  try {
    const title = cleanDraft.title.trim() || 'Resumo Sem Título';
    const template_type = cleanDraft.template_type || 'general';

    const [saved] = await request('summaries', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        title,
        content: cleanDraft.content,
        template_type,
        source_file_name: cleanDraft.source_file_name || null,
        content_hash: cleanDraft.content_hash || null,
        tags: cleanDraft.tags || [],
      }),
    });
    if (saved) return { ...saved, content: stripPageReferences(saved.content) };
  } catch (err) {
    console.warn('[summaryApi] Supabase save failed, falling back to local storage:', err);
  }

  return saveLocalSummary(cleanDraft);
}

export async function deleteSummary(id: string): Promise<void> {
  const filtered = readMock().filter((s) => s.id !== id);
  writeMock(filtered);

  if (!isMock) {
    try {
      await request(`summaries?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('[summaryApi] Supabase delete failed:', err);
    }
  }
}

export async function updateSummary(
  id: string,
  updates: Partial<Pick<SavedSummary, 'title' | 'content' | 'tags'>>
): Promise<SavedSummary> {
  const timestamp = new Date().toISOString();
  const localList = readMock();
  const index = localList.findIndex((s) => s.id === id);

  let updatedItem: SavedSummary;

  if (index !== -1) {
    updatedItem = {
      ...localList[index],
      ...updates,
      updated_at: timestamp,
    };
    localList[index] = updatedItem;
    writeMock(localList);
  } else {
    updatedItem = {
      id,
      title: updates.title || 'Resumo Editado',
      content: updates.content || '',
      template_type: 'general',
      tags: updates.tags || [],
      created_at: timestamp,
      updated_at: timestamp,
    };
    writeMock([updatedItem, ...localList]);
  }

  if (!isMock) {
    try {
      const [remoteUpdated] = await request(`summaries?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          ...updates,
          updated_at: timestamp,
        }),
      });
      if (remoteUpdated) return remoteUpdated;
    } catch (err) {
      console.warn('[summaryApi] Supabase update failed, saved locally:', err);
    }
  }

  return updatedItem;
}

const userTagsKey = 'resumex_user_tags';

export function getStoredUserTags(): string[] {
  try {
    const defaultTags = ['Resumo Médico', 'Anatomia', 'Cirurgia', 'Farmacologia', 'Fisiologia', 'Patologia', 'Cardiologia'];
    const saved = JSON.parse(localStorage.getItem(userTagsKey) || '[]');
    const set = new Set([...defaultTags, ...saved]);
    return Array.from(set);
  } catch {
    return ['Resumo Médico', 'Anatomia', 'Cirurgia', 'Farmacologia', 'Fisiologia', 'Patologia', 'Cardiologia'];
  }
}

export function saveStoredUserTag(tag: string): string[] {
  const cleanTag = tag.trim().replace(/^#/, '');
  if (!cleanTag) return getStoredUserTags();
  const current = getStoredUserTags();
  if (!current.includes(cleanTag)) {
    const updated = [...current, cleanTag];
    localStorage.setItem(userTagsKey, JSON.stringify(updated));
    return updated;
  }
  return current;
}

export function deleteStoredUserTag(tag: string): string[] {
  const cleanTag = tag.trim().replace(/^#/, '');
  const current = getStoredUserTags();
  const updated = current.filter((t) => t.toLowerCase() !== cleanTag.toLowerCase());
  localStorage.setItem(userTagsKey, JSON.stringify(updated));
  return updated;
}
