import { useRef, useState } from 'react';
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import type { Grade } from 'ts-fsrs';
import type { Flashcard, FlashcardDeck } from '../domain/flashcards';
import { recordReview } from '../services/flashcardApi';
import { formatInterval, previewReviews, Rating, scheduleReview, State } from '../services/flashcardScheduler';

const labels = {
  [Rating.Again]: 'Novamente',
  [Rating.Hard]: 'Difícil',
  [Rating.Good]: 'Bom',
  [Rating.Easy]: 'Fácil',
};

type Props = {
  deck: FlashcardDeck;
  cards: Flashcard[];
  reviewedToday: number;
  newToday: number;
  onCardReviewed: (card: Flashcard, previousState: State) => void;
  onExit: () => void;
};

export default function ReviewSession({
  deck,
  cards,
  reviewedToday,
  newToday,
  onCardReviewed,
  onExit,
}: Props) {
  const [queue] = useState(() => {
    const now = Date.now();
    const reviews = cards
      .filter((card) => card.state !== State.New && new Date(card.due).getTime() <= now)
      .slice(0, Math.max(0, deck.max_reviews_per_day - reviewedToday));
    const newCards = cards
      .filter((card) => card.state === State.New)
      .slice(0, Math.max(0, deck.new_cards_per_day - newToday));
    return [...reviews, ...newCards];
  });

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const shownAt = useRef(Date.now());
  const current = queue[index];
  const previews = current ? previewReviews(current, deck) : [];

  const handleRating = async (rating: Grade) => {
    if (!current || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const review = scheduleReview(current, deck, rating);
      const saved = await recordReview(current, review, Date.now() - shownAt.current);
      onCardReviewed(saved, current.state);
      setIndex((value) => value + 1);
      setRevealed(false);
      shownAt.current = Date.now();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Não foi possível registrar a revisão.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!current) {
    return (
      <main className="flashcard-review-shell">
        <section className="flashcard-complete">
          <span className="flashcard-complete-icon"><Check aria-hidden="true" /></span>
          <p>Sessão concluída</p>
          <h1>Você terminou por agora.</h1>
          <span>{queue.length ? `${queue.length} ${queue.length === 1 ? 'cartão revisado' : 'cartões revisados'}.` : 'Nenhum cartão está pendente.'}</span>
          <button className="btn btn-primary" onClick={onExit}>Voltar ao baralho</button>
        </section>
      </main>
    );
  }

  return (
    <main className="flashcard-review-shell">
      <header className="flashcard-review-header">
        <button className="flashcard-back-button" onClick={onExit}><ArrowLeft size={18} /> Sair</button>
        <div>
          <strong>{deck.name}</strong>
          <span>{index + 1} de {queue.length}</span>
        </div>
      </header>

      <div className="flashcard-review-progress" aria-hidden="true">
        <span style={{ width: `${(index / queue.length) * 100}%` }} />
      </div>

      <section className={`flashcard-review-card ${revealed ? 'is-revealed' : ''}`}>
        <span className="flashcard-side-label">{revealed ? 'Resposta' : 'Pergunta'}</span>
        <div className="flashcard-review-content">{revealed ? current.back : current.front}</div>
      </section>

      {error && <div className="upload-error" role="alert">{error}</div>}

      {!revealed ? (
        <button className="btn btn-primary flashcard-reveal-button" onClick={() => setRevealed(true)}>
          <RotateCcw size={18} aria-hidden="true" /> Mostrar resposta
        </button>
      ) : (
        <div className="flashcard-rating-grid" aria-label="Avaliar resposta">
          {previews.map((preview) => (
            <button
              key={preview.rating}
              className={`flashcard-rating rating-${preview.rating}`}
              disabled={isSaving}
              onClick={() => handleRating(preview.rating as Grade)}
            >
              <span>{formatInterval(preview.due)}</span>
              <strong>{labels[preview.rating]}</strong>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
