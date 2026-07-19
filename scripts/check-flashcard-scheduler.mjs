import assert from 'node:assert/strict';
import { Rating, createEmptyCard, fsrs } from 'ts-fsrs';

const now = new Date('2026-07-19T12:00:00.000Z');
const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
});
const preview = scheduler.repeat(createEmptyCard(now), now);

assert.equal(preview[Rating.Again].card.due.toISOString(), '2026-07-19T12:01:00.000Z');
assert.equal(preview[Rating.Good].card.due.toISOString(), '2026-07-19T12:10:00.000Z');
assert.ok(preview[Rating.Easy].card.due > preview[Rating.Good].card.due);
assert.equal(preview[Rating.Good].log.rating, Rating.Good);

console.log('Flashcard scheduler check passed.');
