import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Layers3, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { Flashcard, FlashcardDeck, FlashcardDraft } from '../domain/flashcards';
import {
  createCards,
  createDeck,
  deleteCard,
  deleteDeck,
  listCards,
  listDecks,
  listTodayReviews,
  updateCard,
} from '../services/flashcardApi';
import { State } from '../services/flashcardScheduler';
import CardEditor from './CardEditor';
import ReviewSession from './ReviewSession';
import FicharioAction from '../../../shared/components/FicharioAction';

type Props = {
  initialDrafts?: FlashcardDraft[];
};

export default function FlashcardHome({ initialDrafts = [] }: Props) {
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [todayStates, setTodayStates] = useState<number[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState(initialDrafts);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) || null;

  const loadDeck = useCallback(async (deckId: string) => {
    setCards(await listCards(deckId));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [nextDecks, reviews] = await Promise.all([listDecks(), listTodayReviews()]);
      setDecks(nextDecks);
      setTodayStates(reviews.map((review) => review.state));
      const nextId = selectedDeckId || nextDecks[0]?.id || '';
      setSelectedDeckId(nextId);
      setCards(nextId ? await listCards(nextId) : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os flashcards.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedDeckId]);

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      newCards: cards.filter((card) => card.state === State.New).length,
      learning: cards.filter((card) => card.state === State.Learning || card.state === State.Relearning).length,
      reviews: cards.filter((card) => card.state !== State.New && new Date(card.due).getTime() <= now).length,
    };
  }, [cards]);

  const selectDeck = async (deckId: string) => {
    setSelectedDeckId(deckId);
    setIsLoading(true);
    setError('');
    try {
      await loadDeck(deckId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível abrir o baralho.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateDeck = async (event) => {
    event?.preventDefault();
    const name = newDeckName.trim();
    if (!name) return;
    try {
      const deck = await createDeck(name);
      setDecks((current) => [deck, ...current]);
      setSelectedDeckId(deck.id);
      setCards([]);
      setNewDeckName('');
      setIsCreatingDeck(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Não foi possível criar o baralho.');
    }
  };

  const handleDeleteDeck = async () => {
    if (!selectedDeck || !window.confirm(`Excluir o baralho “${selectedDeck.name}” e todos os seus cartões?`)) return;
    try {
      await deleteDeck(selectedDeck.id);
      const remaining = decks.filter((deck) => deck.id !== selectedDeck.id);
      setDecks(remaining);
      setSelectedDeckId(remaining[0]?.id || '');
      setCards(remaining[0] ? await listCards(remaining[0].id) : []);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o baralho.');
    }
  };

  const handleSaveCard = async (draft: FlashcardDraft) => {
    if (!selectedDeck) return;
    try {
      if (editingCard) {
        const saved = await updateCard(editingCard.id, draft);
        setCards((current) => current.map((card) => card.id === saved.id ? saved : card));
      } else {
        const [saved] = await createCards(selectedDeck.id, [draft]);
        setCards((current) => [...current, saved]);
      }
      setShowEditor(false);
      setEditingCard(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o cartão.');
    }
  };

  const handleImportDrafts = async () => {
    if (!selectedDeck || !pendingDrafts.length) return;
    try {
      const saved = await createCards(selectedDeck.id, pendingDrafts);
      setCards((current) => [...current, ...saved]);
      setPendingDrafts([]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível importar os cartões.');
    }
  };

  const handleDeleteCard = async (card: Flashcard) => {
    if (!window.confirm('Excluir este cartão?')) return;
    try {
      await deleteCard(card.id);
      setCards((current) => current.filter((item) => item.id !== card.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir o cartão.');
    }
  };

  if (isReviewing && selectedDeck) {
    return (
      <ReviewSession
        deck={selectedDeck}
        cards={cards}
        reviewedToday={todayStates.filter((state) => state !== State.New).length}
        newToday={todayStates.filter((state) => state === State.New).length}
        onCardReviewed={(saved, previousState) => {
          setCards((current) => current.map((card) => card.id === saved.id ? saved : card));
          setTodayStates((current) => [...current, previousState]);
        }}
        onExit={() => setIsReviewing(false)}
      />
    );
  }

  return (
    <main className="flashcard-workspace is-embedded">
      <header className="flashcard-page-header">
        <div>
          <p className="workspace-kicker">Revisão espaçada · FSRS-6</p>
          <h2>Seus flashcards</h2>
          <span>Revise o conteúdo certo no momento certo.</span>
        </div>
        <FicharioAction interactive onClick={() => setIsCreatingDeck(true)}>
          <Plus size={16} aria-hidden="true" /> Novo baralho
        </FicharioAction>
      </header>

      {error && <div className="upload-error" role="alert">{error}</div>}

      {isCreatingDeck && (
        <form className="flashcard-new-deck-form" onSubmit={handleCreateDeck}>
          <label htmlFor="new-deck-name">Nome do baralho</label>
          <input
            id="new-deck-name"
            autoFocus
            value={newDeckName}
            onChange={(event) => setNewDeckName(event.target.value)}
            placeholder="Ex.: Neurocirurgia"
            maxLength={120}
          />
          <button className="btn btn-secondary" type="button" onClick={() => { setIsCreatingDeck(false); setNewDeckName(''); }}>Cancelar</button>
          <button className="btn btn-primary" type="submit" disabled={!newDeckName.trim()}>Criar baralho</button>
        </form>
      )}

      <div className="flashcard-layout">
        <aside className="flashcard-deck-sidebar">
          <div className="flashcard-sidebar-heading"><Layers3 size={18} /><span>Seus baralhos</span></div>
          {decks.map((deck) => (
            <button
              key={deck.id}
              className={`flashcard-deck-button ${deck.id === selectedDeckId ? 'is-active' : ''}`}
              onClick={() => selectDeck(deck.id)}
            >
              <BookOpen size={17} /><span>{deck.name}</span>
            </button>
          ))}
          {!isLoading && !decks.length && <p className="flashcard-empty-copy">Crie seu primeiro baralho.</p>}
        </aside>

        <section className="flashcard-deck-main">
          {isLoading ? (
            <div className="flashcard-empty-state">Carregando flashcards…</div>
          ) : !selectedDeck ? (
            <div className="flashcard-empty-state">
              <BookOpen size={34} />
              <h2>Comece com um baralho</h2>
              <p>Agrupe os cartões por matéria, prova ou assunto.</p>
              <button className="btn btn-primary" onClick={() => setIsCreatingDeck(true)}>Criar primeiro baralho</button>
            </div>
          ) : (
            <>
              <div className="flashcard-deck-titlebar">
                <div><span>Baralho</span><h2>{selectedDeck.name}</h2><p>{cards.length} {cards.length === 1 ? 'cartão' : 'cartões'} no total</p></div>
                <div className="flashcard-title-actions">
                  <button className="btn btn-secondary" onClick={() => { setEditingCard(null); setShowEditor(true); }}><Plus size={17} /> Adicionar</button>
                  <button className="flashcard-icon-button danger" onClick={handleDeleteDeck} aria-label="Excluir baralho"><Trash2 size={18} /></button>
                </div>
              </div>

              {pendingDrafts.length > 0 && (
                <div className="flashcard-import-banner">
                  <div><strong>{pendingDrafts.length} cartões prontos</strong><span>Gerados a partir do seu resumo.</span></div>
                  <button className="btn btn-primary" onClick={handleImportDrafts}>Adicionar a {selectedDeck.name}</button>
                </div>
              )}

              <div className="flashcard-count-grid">
                <div><span className="count-new">{counts.newCards}</span><strong>Novos</strong></div>
                <div><span className="count-learning">{counts.learning}</span><strong>Aprendendo</strong></div>
                <div><span className="count-review">{counts.reviews}</span><strong>Para revisar</strong></div>
                <button className="flashcard-study-button" onClick={() => setIsReviewing(true)} disabled={!cards.length}>
                  <Play size={20} fill="currentColor" /><span>Estudar agora</span>
                </button>
              </div>

              {showEditor && (
                <CardEditor card={editingCard} onSave={handleSaveCard} onCancel={() => { setShowEditor(false); setEditingCard(null); }} />
              )}

              <div className="flashcard-card-list">
                <div className="flashcard-list-heading"><strong>Cartões</strong><span>{cards.length}</span></div>
                {cards.map((card) => (
                  <article className="flashcard-list-item" key={card.id}>
                    <div><span>Frente</span><strong>{card.front}</strong></div>
                    <div><span>Verso</span><p>{card.back}</p></div>
                    <div className="flashcard-row-actions">
                      <button onClick={() => { setEditingCard(card); setShowEditor(true); }} aria-label="Editar cartão"><Pencil size={16} /></button>
                      <button onClick={() => handleDeleteCard(card)} aria-label="Excluir cartão"><Trash2 size={16} /></button>
                    </div>
                  </article>
                ))}
                {!cards.length && <div className="flashcard-empty-copy">Este baralho ainda não tem cartões.</div>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
