import { useState, useEffect } from 'react';

const STEPS = [
  { label: 'Analisando estrutura do PDF', duration: 1500 },
  { label: 'Extraindo conceitos-chave', duration: 3000 },
  { label: 'Gerando resumo com IA', duration: 0 }, 
  { label: 'Realizando auditoria automática', duration: 0 }
];

export default function ProcessingView({ isAuditing = false }) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timers = [];

    let elapsed = 0;
    // Set timers for the first two automatic steps
    for (let i = 0; i < 2; i++) {
      elapsed += STEPS[i].duration;
      timers.push(
        setTimeout(() => setActiveStep(i + 1), elapsed)
      );
    }

    return () => timers.forEach(clearTimeout);
  }, []);

  // Update active step based on external audit state
  useEffect(() => {
    if (isAuditing) {
      setActiveStep(3); // Go to final audit step
    } else if (activeStep === 3 && !isAuditing) {
      setActiveStep(2); // Go back to summary generation if needed
    }
  }, [isAuditing, activeStep]);

  return (
    <div className="processing-section">
      <div className="processing-animation">
        <div className="processing-ring" style={{ borderTopColor: isAuditing ? 'var(--accent-mint)' : 'var(--accent-cyan)' }} />
        <div className="processing-ring" style={{ borderRightColor: isAuditing ? 'var(--accent-cyan)' : 'var(--accent-mint)', animationDirection: 'reverse' }} />
        <div className="processing-ring" />
        <div className="processing-core">{isAuditing ? '🛡️' : '🧬'}</div>
      </div>

      <div className="processing-text">
        <h3>{isAuditing ? 'Auditando Resumo' : 'Processando seu material'}</h3>
        <p>
          {isAuditing 
            ? 'Nossa IA auditora está revisando a fidelidade dos dados e as citações...' 
            : 'A IA está analisando o PDF e gerando o resumo estruturado...'
          }
        </p>
      </div>

      <div className="processing-steps">
        {STEPS.map((step, index) => {
          let stepStatus = 'pending';
          if (index < activeStep) stepStatus = 'done';
          else if (index === activeStep) stepStatus = 'active';

          return (
            <div
              key={index}
              className={`processing-step ${stepStatus}`}
            >
              <span className="processing-step-icon">
                {stepStatus === 'done' ? '✓' : stepStatus === 'active' ? '●' : '○'}
              </span>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
