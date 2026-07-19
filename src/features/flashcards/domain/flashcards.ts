import type { Grade, State } from 'ts-fsrs';

export type FlashcardDeck = {
  id: string;
  name: string;
  desired_retention: number;
  new_cards_per_day: number;
  max_reviews_per_day: number;
  created_at: string;
  updated_at: string;
};

export type Flashcard = {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type FlashcardDraft = {
  front: string;
  back: string;
};

export type ScheduledReview = {
  rating: Grade;
  card: Record<string, string | number | null>;
  log: Record<string, string | number>;
  due: Date;
};
