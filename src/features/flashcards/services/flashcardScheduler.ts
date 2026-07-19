import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
  type ReviewLog,
} from 'ts-fsrs';
import type { Flashcard, FlashcardDeck, ScheduledReview } from '../domain/flashcards';

export { Rating, State };

function schedulerFor(deck: FlashcardDeck) {
  return fsrs({
    request_retention: deck.desired_retention,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  });
}

function toFsrsCard(card: Flashcard): Card {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };
}

function serializeCard(card: Card) {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review?.toISOString() ?? null,
  };
}

function serializeLog(log: ReviewLog) {
  return {
    ...log,
    due: log.due.toISOString(),
    review: log.review.toISOString(),
  };
}

export function emptyFsrsCard(now = new Date()) {
  return serializeCard(createEmptyCard(now));
}

export function previewReviews(card: Flashcard, deck: FlashcardDeck, now = new Date()) {
  const preview = schedulerFor(deck).repeat(toFsrsCard(card), now);

  return [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((rating) => ({
    rating,
    due: preview[rating].card.due,
  }));
}

export function scheduleReview(
  card: Flashcard,
  deck: FlashcardDeck,
  rating: Grade,
  now = new Date(),
): ScheduledReview {
  const result = schedulerFor(deck).next(toFsrsCard(card), now, rating);
  return {
    rating,
    card: serializeCard(result.card),
    log: serializeLog(result.log),
    due: result.card.due,
  };
}

export function formatInterval(due: Date, now = new Date()) {
  const milliseconds = Math.max(0, due.getTime() - now.getTime());
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} m`;
  return `${Math.round(months / 12)} a`;
}
