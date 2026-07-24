import { buildAuthHeaders } from '../../auth/services/authClient';

export interface SavedQuiz {
  id: string;
  user_id?: string;
  summary_id?: string;
  title: string;
  questions: any[];
  created_at: string;
}

export interface SavedQuizAttempt {
  id: string;
  quiz_id: string;
  user_id?: string;
  score: number;
  answers: Record<string, any>;
  duration_seconds?: number;
  completed_at: string;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const isMock = !supabaseUrl || !supabaseKey || (import.meta.env.DEV && import.meta.env.VITE_E2E_MOCK === 'true');

const mockQuizzesKey = 'resumex_mock_quizzes';
const mockAttemptsKey = 'resumex_mock_quiz_attempts';

function readMock<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function writeMock<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
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
    throw new Error(payload?.message || payload?.hint || 'Erro ao comunicar com a base de simulados.');
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function listQuizzes(): Promise<SavedQuiz[]> {
  if (isMock) return readMock<SavedQuiz>(mockQuizzesKey);
  return request('quizzes?select=*&order=created_at.desc');
}

export async function createQuiz(title: string, questions: any[], summaryId?: string): Promise<SavedQuiz> {
  const timestamp = new Date().toISOString();
  const cleanTitle = title.trim() || 'Simulado Médico';

  if (isMock) {
    const quiz: SavedQuiz = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      summary_id: summaryId,
      questions,
      created_at: timestamp,
    };
    writeMock(mockQuizzesKey, [quiz, ...readMock<SavedQuiz>(mockQuizzesKey)]);
    return quiz;
  }

  const [saved] = await request('quizzes', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      title: cleanTitle,
      questions,
      summary_id: summaryId || null,
    }),
  });

  return saved;
}

export async function recordQuizAttempt(
  quizId: string,
  score: number,
  answers: Record<string, any>,
  durationSeconds?: number,
): Promise<SavedQuizAttempt> {
  const timestamp = new Date().toISOString();

  if (isMock) {
    const attempt: SavedQuizAttempt = {
      id: crypto.randomUUID(),
      quiz_id: quizId,
      score,
      answers,
      duration_seconds: durationSeconds,
      completed_at: timestamp,
    };
    writeMock(mockAttemptsKey, [attempt, ...readMock<SavedQuizAttempt>(mockAttemptsKey)]);
    return attempt;
  }

  const [saved] = await request('quiz_attempts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      quiz_id: quizId,
      score,
      answers,
      duration_seconds: durationSeconds || null,
    }),
  });

  return saved;
}

export async function listQuizAttempts(quizId?: string): Promise<SavedQuizAttempt[]> {
  if (isMock) {
    const attempts = readMock<SavedQuizAttempt>(mockAttemptsKey);
    return quizId ? attempts.filter((a) => a.quiz_id === quizId) : attempts;
  }
  const query = quizId
    ? `quiz_attempts?select=*&quiz_id=eq.${encodeURIComponent(quizId)}&order=completed_at.desc`
    : 'quiz_attempts?select=*&order=completed_at.desc';
  return request(query);
}

export async function deleteQuiz(quizId: string): Promise<void> {
  if (isMock) {
    writeMock(mockQuizzesKey, readMock<SavedQuiz>(mockQuizzesKey).filter((q) => q.id !== quizId));
    writeMock(mockAttemptsKey, readMock<SavedQuizAttempt>(mockAttemptsKey).filter((a) => a.quiz_id !== quizId));
    return;
  }
  await request(`quizzes?id=eq.${encodeURIComponent(quizId)}`, { method: 'DELETE' });
}
