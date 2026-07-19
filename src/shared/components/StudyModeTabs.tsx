export type StudyMode = 'summary' | 'quiz' | 'flashcards';

type StudyModeTabsProps = {
  activeMode: StudyMode;
  onSelect: (mode: StudyMode) => void;
};

const modes: Array<{ id: StudyMode; number: string; title: string; description: string }> = [
  { id: 'summary', number: '01', title: 'Resumo', description: 'Organize o conteúdo com referências por página.' },
  { id: 'quiz', number: '02', title: 'Simulado', description: 'Gere questões e acompanhe seu desempenho.' },
  { id: 'flashcards', number: '03', title: 'Flashcards', description: 'Memorize conceitos com revisão rápida.' },
];

export default function StudyModeTabs({ activeMode, onSelect }: StudyModeTabsProps) {
  return (
    <div className="study-mode-grid" aria-label="Atividades disponíveis">
      {modes.map((mode) => {
        const isActive = activeMode === mode.id;
        return (
          <button
            key={mode.id}
            className={`study-mode-card ${isActive ? 'is-active' : ''}`}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(mode.id)}
          >
            <span className="study-mode-number">{mode.number}</span>
            <span className="study-mode-copy">
              <strong>{mode.title}</strong>
              <span>{mode.description}</span>
            </span>
            <span className="study-mode-status">{isActive ? 'Selecionado' : 'Abrir →'}</span>
          </button>
        );
      })}
    </div>
  );
}
