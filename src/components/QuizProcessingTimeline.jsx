const QUIZ_TIMELINE_STEPS = [
  {
    id: 'files',
    title: 'Arquivos recebidos',
    description: 'Conferimos os PDFs enviados e preparamos o material para leitura.',
  },
  {
    id: 'vision',
    title: 'Leitura visual quando precisa',
    description: 'Se houver foto, prova escaneada ou imagem, o PDF é convertido e transcrito.',
  },
  {
    id: 'classify',
    title: 'Organização do conteúdo',
    description: 'Separamos teoria, bancos de questões e blocos por tema.',
  },
  {
    id: 'extract',
    title: 'Questões dos arquivos',
    description: 'Quando o modo misto está ativo, extraímos questões reais dos PDFs.',
  },
  {
    id: 'generate',
    title: 'Criação do simulado',
    description: 'A IA cria perguntas novas usando a teoria e o estilo dos materiais.',
  },
  {
    id: 'audit',
    title: 'Revisão de qualidade',
    description: 'Filtramos repetições, ambiguidades e equilibramos os temas.',
  },
  {
    id: 'finish',
    title: 'Montagem final',
    description: 'Escolhemos as melhores questões e deixamos o teste pronto.',
  },
];

function getStepState(stepIndex, currentIndex) {
  if (stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

export default function QuizProcessingTimeline({ stage = 'files', message, onCancel }) {
  const currentIndex = Math.max(
    0,
    QUIZ_TIMELINE_STEPS.findIndex((step) => step.id === stage)
  );
  const progress = Math.round(((currentIndex + 1) / QUIZ_TIMELINE_STEPS.length) * 100);

  return (
    <div className="quiz-processing-section">
      <div className="quiz-processing-header">
        <span className="quiz-kicker">Gerando teste</span>
        <h1>Estamos montando seu simulado</h1>
        <p>{message || 'Preparando o conteúdo e avançando etapa por etapa.'}</p>
      </div>

      <div className="quiz-processing-progress" aria-label={`Progresso ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="quiz-timeline">
        {QUIZ_TIMELINE_STEPS.map((step, index) => {
          const state = getStepState(index, currentIndex);
          return (
            <div className={`quiz-timeline-step ${state}`} key={step.id}>
              <div className="quiz-timeline-marker">{state === 'done' ? '✓' : index + 1}</div>
              <div>
                <strong>{step.title}</strong>
                <span>{step.description}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="quiz-processing-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancelar geração
        </button>
      </div>
    </div>
  );
}
