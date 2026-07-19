import { useEffect, useState } from 'react';
import type { Flashcard, FlashcardDraft } from '../domain/flashcards';

type Props = {
  card?: Flashcard | null;
  onSave: (draft: FlashcardDraft) => Promise<void>;
  onCancel: () => void;
};

export default function CardEditor({ card, onSave, onCancel }: Props) {
  const [front, setFront] = useState(card?.front || '');
  const [back, setBack] = useState(card?.back || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFront(card?.front || '');
    setBack(card?.back || '');
  }, [card]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!front.trim() || !back.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ front, back });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="flashcard-editor" onSubmit={handleSubmit}>
      <div className="flashcard-editor-heading">
        <div>
          <span>{card ? 'Editar cartão' : 'Novo cartão'}</span>
          <h3>Frente e verso</h3>
        </div>
        <button className="flashcard-text-button" type="button" onClick={onCancel}>Fechar</button>
      </div>

      <label>
        Frente
        <textarea
          autoFocus
          value={front}
          onChange={(event) => setFront(event.target.value)}
          placeholder="Ex.: Qual é a tríade de Cushing?"
          rows={4}
          maxLength={10000}
        />
      </label>

      <label>
        Verso
        <textarea
          value={back}
          onChange={(event) => setBack(event.target.value)}
          placeholder="Ex.: Hipertensão, bradicardia e alteração respiratória."
          rows={6}
          maxLength={20000}
        />
      </label>

      <div className="flashcard-editor-actions">
        <button className="btn btn-secondary" type="button" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" type="submit" disabled={!front.trim() || !back.trim() || isSaving}>
          {isSaving ? 'Salvando…' : 'Salvar cartão'}
        </button>
      </div>
    </form>
  );
}

