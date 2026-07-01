import { useMemo, useState } from 'react';

function getKindLabel(kind) {
  if (kind === 'question_bank') return 'Banco de questoes';
  if (kind === 'mixed') return 'Misto';
  return 'Teoria';
}

export default function QuizView({ files, questions, analysis, onNewQuiz }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

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
          <span>{submitted ? 'Pontuacao' : 'Status'}</span>
          <strong>{submitted ? `${score}/${questions.length} (${percent}%)` : 'Em andamento'}</strong>
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
            <span>{getKindLabel(file.kind)} · {file.numPages} paginas</span>
          </div>
        ))}
      </div>

      <div className="quiz-question-list">
        {questions.map((question, index) => {
          const selected = answers[question.id];
          const isCorrect = selected === question.answerIndex;

          return (
            <article className="quiz-question-card" key={question.id}>
              <div className="quiz-question-top">
                <span>
                  Questao {index + 1} · {question.origin === 'extracted' ? 'extraida do banco' : 'gerada pela IA'}
                </span>
                {submitted && (
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
                    submitted && correctOption ? 'correct' : '',
                    submitted && selectedOption && !correctOption ? 'wrong' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <button
                      type="button"
                      className={className}
                      key={`${question.id}-${optionIndex}`}
                      onClick={() => {
                        if (!submitted) setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }));
                      }}
                    >
                      <span>{String.fromCharCode(65 + optionIndex)}</span>
                      {option}
                    </button>
                  );
                })}
              </div>
              {submitted && (
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
        {!submitted ? (
          <button
            className="btn btn-primary btn-lg"
            onClick={() => setSubmitted(true)}
            disabled={answeredCount !== questions.length}
          >
            Corrigir teste
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => {
            setAnswers({});
            setSubmitted(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}>
            Refazer este teste
          </button>
        )}
      </div>
    </div>
  );
}
