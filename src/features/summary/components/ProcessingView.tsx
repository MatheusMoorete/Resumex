import { Check, Circle } from 'lucide-react';
import NotebookLoadingAnimation from '../../loading/components/NotebookLoadingAnimation';

const STEPS = [
  'Gerando o resumo a partir do plano aprovado',
  'Auditando fidelidade, valores e referências',
];

export default function ProcessingView({ isAuditing = false }) {
  const activeStep = isAuditing ? 1 : 0;

  return (
    <div className="processing-section summary-processing-section">
      <span className="processing-kicker">RESUMO / ETAPA FINAL</span>
      <NotebookLoadingAnimation duration={isAuditing ? 1 : .78} />

      <div className="processing-text" role="status" aria-live="polite">
        <h3>{isAuditing ? 'Conferindo o resumo' : 'Escrevendo seu resumo'}</h3>
        <p>
          {isAuditing 
            ? 'Um segundo modelo está revisando fidelidade, valores e referências antes da entrega.'
            : 'O conteúdo está sendo organizado conforme o plano que você acabou de aprovar.'
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
                {stepStatus === 'done'
                  ? <Check aria-hidden="true" />
                  : <Circle fill={stepStatus === 'active' ? 'currentColor' : 'none'} aria-hidden="true" />}
              </span>
              <span>{step}</span>
            </div>
          );
        })}
      </div>
      <p className="processing-note">Mantenha esta aba aberta. O resultado aparecerá automaticamente quando estiver pronto.</p>
    </div>
  );
}
