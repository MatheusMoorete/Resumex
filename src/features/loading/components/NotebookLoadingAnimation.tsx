import type { CSSProperties } from 'react';
import './LoadingAnimations.css';

interface NotebookLoadingAnimationProps {
  duration?: number;
  paused?: boolean;
  closing?: boolean;
}

export default function NotebookLoadingAnimation({
  duration = 0.75,
  paused = false,
  closing = false,
}: NotebookLoadingAnimationProps) {
  return (
    <div
      className={`loading-animation notebook-animation${closing ? ' is-closing' : ''}${paused ? ' is-paused' : ''}`}
      style={{ '--loading-duration': `${duration}s` } as CSSProperties}
      role="img"
      aria-label={closing ? 'Caderno ResumeX fechado' : 'Páginas do caderno ResumeX sendo viradas'}
    >
      <img
        className="loading-animation-sprite"
        src="/resumex-loading-frames.png"
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}
