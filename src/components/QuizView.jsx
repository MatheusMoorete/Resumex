import { useMemo, useState } from 'react';

function getKindLabel(kind) {
  if (kind === 'question_bank') return 'Banco de questoes';
  if (kind === 'mixed') return 'Misto';
  if (kind === 'needs_vision') return 'Precisa de OCR';
  return 'Teoria';
}

function getReadModeLabel(file) {
  if (file.visualStatus === 'partial') return 'OCR parcial';
  if (file.visualStatus === 'transcribed') return 'OCR visual';
  if (file.readMode === 'visual') return 'Imagem/OCR';
  return 'Texto';
}

export default function QuizView({ files, questions, analysis, onNewQuiz }) {
  const [answers, setAnswers] = useState({});

  const answeredCount = Object.keys(answers).length;
  const score = useMemo(() => (
    questions.reduce((total, question) => (
      answers[question.id] === question.answerIndex ? total + 1 : total
    ), 0)
  ), [answers, questions]);

  const percent = questions.length ? Math.round((score / questions.length) * 100) : 0;
  const extractedCount = questions.filter((question) => question.origin === 'extracted').length;
  const generatedCount = questions.filter((question) => question.origin === 'generated').length;
  const classifiedFiles = analysis?.classifiedFiles || files;
  const contentIndex = analysis?.contentIndex;
  const auditSummary = analysis?.auditSummary;

  return (
    <div className="quiz-view-section">
      <div className="quiz-view-header">
        <div>
          <span className="quiz-kicker">Teste gerado</span>
          <h1>{questions.length} questoes para resolver</h1>
          <p>{files.length} {files.length === 1 ? 'arquivo usado' : 'arquivos usados'} como base.</p>
        </div>
        <button className="btn btn-secondary" onClick={onNewQuiz}>Novo teste</button>
      </div>

      <div className="quiz-progress-panel">
        <div>
          <span>Respondidas</span>
          <strong>{answeredCount}/{questions.length}</strong>
        </div>
        <div>
          <span>Pontuacao</span>
          <strong>{score}/{answeredCount || questions.length}{answeredCount === questions.length ? ` (${percent}%)` : ''}</strong>
        </div>
        <div>
          <span>Extraidas</span>
          <strong>{extractedCount}</strong>
        </div>
        <div>
          <span>Geradas</span>
          <strong>{generatedCount}</strong>
        </div>
      </div>

      <div className="quiz-corpus-panel">
        {classifiedFiles.map((file) => (
          <div className="quiz-corpus-file" key={`${file.name}-${file.size}`}>
            <strong>{file.name}</strong>
            <span>{getKindLabel(file.kind)} - {getReadModeLabel(file)} - {file.numPages} paginas</span>
          </div>
        ))}
      </div>

      {contentIndex && (
        <div className="quiz-index-panel">
          <strong>{contentIndex.chunkCount} blocos analisados</strong>
          <span>{contentIndex.topics.slice(0, 8).join(' - ')}</span>
          {auditSummary && (
            <span>
              Auditoria: {auditSummary.approved}/{auditSummary.audited} aprovadas - {auditSummary.delivered} entregues
            </span>
          )}
        </div>
      )}

      <div className="quiz-question-list">
        {questions.map((question, index) => {
          const selected = answers[question.id];
          const answered = selected !== undefined;
          const isCorrect = selected === question.answerIndex;

          return (
            <article className="quiz-question-card" key={question.id}>
              <div className="quiz-question-top">
                <span>
                  Questao {index + 1} - {question.origin === 'extracted' ? 'extraida do banco' : 'gerada pela IA'}
                </span>
                {answered && (
                  <strong className={isCorrect ? 'quiz-correct' : 'quiz-wrong'}>
                    {isCorrect ? 'Correta' : 'Revisar'}
                  </strong>
                )}
              </div>
              <h2>{question.stem}</h2>
              <div className="quiz-options">
                {question.options.map((option, optionIndex) => {
                  const selectedOption = selected === optionIndex;
                  const correctOption = question.answerIndex === optionIndex;
                  const className = [
                    'quiz-option',
                    selectedOption ? 'selected' : '',
                    answered && correctOption ? 'correct' : '',
                    answered && selectedOption && !correctOption ? 'wrong' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <button
                      type="button"
                      className={className}
                      key={`${question.id}-${optionIndex}`}
                      onClick={() => {
                        if (!answered) setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }));
                      }}
                      disabled={answered}
                    >
                      <span>{String.fromCharCode(65 + optionIndex)}</span>
                      {option}
                    </button>
                  );
                })}
              </div>
              {answered && (
                <div className="quiz-explanation">
                  <strong>Explicacao</strong>
                  <p>{question.explanation}</p>
                  {question.topic && <span>Tema: {question.topic}</span>}
                  {question.source && <span>{question.source}</span>}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="quiz-submit-bar">
        <button className="btn btn-secondary" onClick={() => {
            setAnswers({});
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}>
          Refazer este teste
        </button>
      </div>
    </div>
  );
}
