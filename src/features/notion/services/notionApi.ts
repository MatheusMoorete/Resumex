import { buildAuthHeaders } from '../../auth/services/authClient';

export async function exportSummaryToNotion({ markdown, title }) {
  const response = await fetch('/api/notion/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...await buildAuthHeaders(),
    },
    credentials: 'same-origin',
    body: JSON.stringify({ markdown, title }),
  });

  const body = await response.text();
  let parsed = null;

  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(parsed?.error?.message || parsed?.message || body || 'Erro ao enviar para o Notion.');
  }

  return parsed;
}
