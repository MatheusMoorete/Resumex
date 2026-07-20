import { Check, Circle } from 'lucide-react';
import NotebookLoadingAnimation from '../../loading/components/NotebookLoadingAnimation';

const STEPS = [
  { stages: ['uploading', 'queued', 'extracting'], label: 'Extraindo o PDF com PyMuPDF' },
  { stages: ['vision_glm', 'vision_kimi'], label: 'Lendo somente imagens e manuscritos necessários' },
  { stages: ['summarizing', 'completed'], label: 'Gerando uma versão final com o DeepSeek' },
];

export default function ProcessingView({ stage = 'queued', progress = 0 }) {
  const activeStep = Math.max(0, STEPS.findIndex((step) => step.stages.includes(stage)));

  return (
    <div className="processing-section summary-processing-section">
      <span className="processing-kicker">RESUMO / FLUXO OTIMIZADO</span>
      <NotebookLoadingAnimation duration={.78} />

      <div className="processing-text" role="status" aria-live="polite">
        <h3>Preparando seu resumo</h3>
        <p>O texto é extraído localmente; a IA visual recebe apenas as páginas que precisam dela.</p>
      </div>

      <div className="upload-progress-bar" role="progressbar" aria-label="Progresso do resumo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span>{progress}% concluído</span>

      <div className="processing-steps">
        {STEPS.map((step, index) => {
          const status = index < activeStep ? 'done' : index === activeStep ? 'active' : 'pending';
          return (
            <div key={step.label} className={`processing-step ${status}`}>
              <span className="processing-step-icon">
                {status === 'done' ? <Check aria-hidden="true" /> : <Circle fill={status === 'active' ? 'currentColor' : 'none'} aria-hidden="true" />}
              </span>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
      <p className="processing-note">Mantenha esta aba aberta. O resultado aparecerá automaticamente.</p>
    </div>
  );
}
