import { buildAuthHeaders } from '../../auth/services/authClient';
import type { Flashcard, FlashcardDeck, FlashcardDraft, ScheduledReview } from '../domain/flashcards';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const isMock = import.meta.env.DEV && import.meta.env.VITE_E2E_MOCK === 'true';
const mockDecksKey = 'resumex_mock_flashcard_decks';
const mockCardsKey = 'resumex_mock_flashcards';
const mockReviewsKey = 'resumex_mock_flashcard_reviews';

function readMock<T>(key: string): T[] {
  return JSON.parse(localStorage.getItem(key) || '[]');
}

function writeMock<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

async function request(path: string, options: RequestInit = {}) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase não está configurado para salvar flashcards.');
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
    throw new Error(payload?.message || payload?.hint || 'Não foi possível salvar os flashcards.');
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function listDecks(): Promise<FlashcardDeck[]> {
  if (isMock) return readMock<FlashcardDeck>(mockDecksKey);
  return request('flashcard_decks?select=*&order=updated_at.desc');
}

export async function createDeck(name: string): Promise<FlashcardDeck> {
  if (isMock) {
    const timestamp = now();
    const deck: FlashcardDeck = {
      id: crypto.randomUUID(),
      name: name.trim(),
      desired_retention: 0.9,
      new_cards_per_day: 20,
      max_reviews_per_day: 200,
      created_at: timestamp,
      updated_at: timestamp,
    };
    writeMock(mockDecksKey, [deck, ...readMock<FlashcardDeck>(mockDecksKey)]);
    return deck;
  }
  const [deck] = await request('flashcard_decks', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: name.trim() }),
  });
  return deck;
}

export async function deleteDeck(deckId: string) {
  if (isMock) {
    writeMock(mockDecksKey, readMock<FlashcardDeck>(mockDecksKey).filter((deck) => deck.id !== deckId));
    writeMock(mockCardsKey, readMock<Flashcard>(mockCardsKey).filter((card) => card.deck_id !== deckId));
    return;
  }
  await request(`flashcard_decks?id=eq.${encodeURIComponent(deckId)}`, { method: 'DELETE' });
}

export async function listCards(deckId: string): Promise<Flashcard[]> {
  if (isMock) return readMock<Flashcard>(mockCardsKey).filter((card) => card.deck_id === deckId);
  return request(`flashcards?select=*&deck_id=eq.${encodeURIComponent(deckId)}&order=created_at.asc`);
}

export async function listTodayReviews(): Promise<Array<{ state: number }>> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (isMock) {
    return readMock<{ state: number; reviewed_at: string }>(mockReviewsKey)
      .filter((review) => new Date(review.reviewed_at) >= start)
      .map(({ state }) => ({ state }));
  }
  return request(`flashcard_reviews?select=state&reviewed_at=gte.${encodeURIComponent(start.toISOString())}`);
}

export async function createCards(deckId: string, drafts: FlashcardDraft[]): Promise<Flashcard[]> {
  const cards = drafts
    .map((draft) => ({ deck_id: deckId, front: draft.front.trim(), back: draft.back.trim() }))
    .filter((card) => card.front && card.back);
  if (!cards.length) return [];

  if (isMock) {
    const created = cards.map((card) => {
      const timestamp = now();
      return {
        ...card,
        id: crypto.randomUUID(),
        due: timestamp,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        last_review: null,
        version: 0,
        created_at: timestamp,
        updated_at: timestamp,
      } as Flashcard;
    });
    writeMock(mockCardsKey, [...readMock<Flashcard>(mockCardsKey), ...created]);
    return created;
  }

  return request('flashcards', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(cards),
  });
}

export async function updateCard(cardId: string, draft: FlashcardDraft): Promise<Flashcard> {
  if (isMock) {
    let saved: Flashcard | undefined;
    const cards = readMock<Flashcard>(mockCardsKey).map((card) => {
      if (card.id !== cardId) return card;
      saved = { ...card, front: draft.front.trim(), back: draft.back.trim(), updated_at: now() };
      return saved;
    });
    if (!saved) throw new Error('Cartão não encontrado.');
    writeMock(mockCardsKey, cards);
    return saved;
  }
  const [card] = await request(`flashcards?id=eq.${encodeURIComponent(cardId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ front: draft.front.trim(), back: draft.back.trim(), updated_at: new Date().toISOString() }),
  });
  return card;
}

export async function deleteCard(cardId: string) {
  if (isMock) {
    writeMock(mockCardsKey, readMock<Flashcard>(mockCardsKey).filter((card) => card.id !== cardId));
    return;
  }
  await request(`flashcards?id=eq.${encodeURIComponent(cardId)}`, { method: 'DELETE' });
}

export async function recordReview(
  card: Flashcard,
  review: ScheduledReview,
  durationMs: number,
): Promise<Flashcard> {
  if (isMock) {
    let saved: Flashcard | undefined;
    const cards = readMock<Flashcard>(mockCardsKey).map((item) => {
      if (item.id !== card.id) return item;
      saved = {
        ...item,
        ...review.card,
        version: item.version + 1,
        updated_at: now(),
      } as Flashcard;
      return saved;
    });
    if (!saved) throw new Error('Cartão não encontrado.');
    writeMock(mockCardsKey, cards);
    writeMock(mockReviewsKey, [
      ...readMock<{ state: number; reviewed_at: string }>(mockReviewsKey),
      { state: card.state, reviewed_at: String(review.log.review) },
    ]);
    return saved;
  }
  return request('rpc/record_flashcard_review', {
    method: 'POST',
    body: JSON.stringify({
      p_card_id: card.id,
      p_expected_version: card.version,
      p_next_card: review.card,
      p_review_log: review.log,
      p_duration_ms: durationMs,
    }),
  });
}
