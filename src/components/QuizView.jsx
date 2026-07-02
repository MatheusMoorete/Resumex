import { useMemo, useState } from 'react';
import { cleanQuizText } from '../services/quizApi';

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

function getQuestionTopic(question) {
  return cleanQuizText(question.balanceTopic || question.topic || 'Geral');
}

function buildQuizStats(questions, answers) {
  const topicMap = new Map();
  const wrongQuestions = [];
  let correct = 0;

  questions.forEach((question, index) => {
    const selected = answers[question.id];
    const answered = selected !== undefined;
    const isCorrect = answered && selected === question.answerIndex;
    const topic = getQuestionTopic(question);
    const current = topicMap.get(topic) || {
      topic,
      total: 0,
      answered: 0,
      correct: 0,
      wrong: 0,
    };

    current.total += 1;
    if (answered) current.answered += 1;
    if (isCorrect) {
      current.correct += 1;
      correct += 1;
    } else if (answered) {
      current.wrong += 1;
      wrongQuestions.push({
        ...question,
        originalIndex: index + 1,
        selectedAnswer: selected,
      });
    }

    topicMap.set(topic, current);
  });

  const topicStats = [...topicMap.values()].sort((a, b) => {
    if (b.wrong !== a.wrong) return b.wrong - a.wrong;
    return (b.wrong / Math.max(1, b.total)) - (a.wrong / Math.max(1, a.total));
  });

  return {
    correct,
    wrong: wrongQuestions.length,
    percent: questions.length ? Math.round((correct / questions.length) * 100) : 0,
    topicStats,
    weakTopics: topicStats.filter((topic) => topic.wrong > 0),
    wrongQuestions,
  };
}

export default function QuizView({
  files,
  questions,
  analysis,
  onNewQuiz,
  onGenerateVariant,
  onHome,
}) {
  const [answers, setAnswers] = useState({});
  const [isFinished, setIsFinished] = useState(false);

  const answeredCount = Object.keys(answers).length;
  const stats = useMemo(() => buildQuizStats(questions, answers), [answers, questions]);
  const percent = answeredCount === questions.length ? stats.percent : (
    answeredCount ? Math.round((stats.correct / answeredCount) * 100) : 0
  );
  const extractedCount = questions.filter((question) => question.origin === 'extracted').length;
  const generatedCount = questions.filter((question) => question.origin === 'generated').length;
  const classifiedFiles = analysis?.classifiedFiles || files;
  const contentIndex = analysis?.contentIndex;
  const auditSummary = analysis?.auditSummary;
  const topicDistribution = auditSummary?.topicDistribution
    ? Object.entries(auditSummary.topicDistribution)
        .map(([topic, count]) => `${cleanQuizText(topic)}: ${count}`)
        .join(' - ')
    : '';
  const canFinish = answeredCount === questions.length && questions.length > 0;

  function resetCurrentTest() {
    setAnswers({});
    setIsFinished(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="quiz-view-section">
      <div className="quiz-view-header">
        <div>
          <span className="quiz-kicker">Teste gerado</span>
          <h1>{questions.length} questoes para resolver</h1>
          <p>{files.length} {files.length === 1 ? 'arquivo usado' : 'arquivos usados'} como base.</p>
        </div>
        <button className="btn btn-secondary" onClick={onNewQuiz}>Novo upload</button>
      </div>

      <div className="quiz-progress-panel">
        <div>
          <span>Respondidas</span>
          <strong>{answeredCount}/{questions.length}</strong>
        </div>
        <div>
          <span>Pontuacao</span>
          <strong>{stats.correct}/{answeredCount || questions.length}{answeredCount > 0 ? ` (${percent}%)` : ''}</strong>
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
          {topicDistribution && <span>Distribuicao: {topicDistribution}</span>}
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
              <h2>{cleanQuizText(question.stem)}</h2>
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
                        if (!answered && !isFinished) {
                          setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }));
                        }
                      }}
                      disabled={answered || isFinished}
                    >
                      <span>{String.fromCharCode(65 + optionIndex)}</span>
                      {cleanQuizText(option)}
                    </button>
                  );
                })}
              </div>
              {answered && (
                <div className="quiz-explanation">
                  <strong>Explicacao</strong>
                  <p>{cleanQuizText(question.explanation)}</p>
                  {question.topic && <span>Tema: {cleanQuizText(question.topic)}</span>}
                  {question.source && <span>{cleanQuizText(question.source)}</span>}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {isFinished && (
        <section className="quiz-finish-panel">
          <div className="quiz-finish-header">
            <span className="quiz-kicker">Estatisticas</span>
            <h2>Resultado do teste</h2>
            <p>{stats.correct} acertos, {stats.wrong} erros, {stats.percent}% de aproveitamento.</p>
          </div>

          <div className="quiz-finish-grid">
            <div>
              <span>Acertos</span>
              <strong>{stats.correct}/{questions.length}</strong>
            </div>
            <div>
              <span>Erros</span>
              <strong>{stats.wrong}</strong>
            </div>
            <div>
              <span>Aproveitamento</span>
              <strong>{stats.percent}%</strong>
            </div>
          </div>

          <div className="quiz-weak-panel">
            <strong>O que mais errou</strong>
            {stats.weakTopics.length > 0 ? (
              <div className="quiz-weak-list">
                {stats.weakTopics.slice(0, 5).map((topic) => (
                  <div className="quiz-weak-row" key={topic.topic}>
                    <span>{cleanQuizText(topic.topic)}</span>
                    <strong>{topic.wrong}/{topic.total} erros</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p>Nenhum tema com erro neste teste.</p>
            )}
          </div>

          {stats.wrongQuestions.length > 0 && (
            <div className="quiz-weak-panel">
              <strong>Questoes que vao orientar o treino</strong>
              <div className="quiz-review-list">
                {stats.wrongQuestions.slice(0, 6).map((question) => (
                  <span key={question.id}>Questao {question.originalIndex}: {getQuestionTopic(question)}</span>
                ))}
              </div>
            </div>
          )}

          <div className="quiz-finish-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onGenerateVariant?.('different')}
            >
              Novo teste diferente
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onGenerateVariant?.('focused', { focusQuestions: stats.wrongQuestions })}
              disabled={stats.wrongQuestions.length === 0}
            >
              Treinar meus erros
            </button>
            <button type="button" className="btn btn-secondary" onClick={onHome}>
              Voltar para home
            </button>
          </div>
        </section>
      )}

      <div className="quiz-submit-bar">
        {!isFinished ? (
          <>
            <span className="quiz-submit-hint">
              {canFinish ? 'Todas as questoes foram respondidas.' : `Responda ${questions.length - answeredCount} questoes para finalizar.`}
            </span>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => setIsFinished(true)}
              disabled={!canFinish}
            >
              Finalizar teste
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={resetCurrentTest}>
              Refazer este teste
            </button>
            <button className="btn btn-primary" onClick={() => onGenerateVariant?.('different')}>
              Outro teste diferente
            </button>
          </>
        )}
      </div>
    </div>
  );
}
