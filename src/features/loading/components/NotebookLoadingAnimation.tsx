import type { CSSProperties } from 'react';
import './LoadingAnimations.css';

interface NotebookLoadingAnimationProps {
  duration?: number;
  paused?: boolean;
}

export default function NotebookLoadingAnimation({
  duration = 0.75,
  paused = false,
}: NotebookLoadingAnimationProps) {
  return (
    <div
      className={`loading-animation notebook-animation${paused ? ' is-paused' : ''}`}
      style={{ '--loading-duration': `${duration}s` } as CSSProperties}
      role="img"
      aria-label="Caderno ResumeX fechando suas páginas"
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
