import type { CSSProperties } from 'react';
import './LoadingAnimations.css';

interface QuizWritingLoadingAnimationProps {
  duration?: number;
  paused?: boolean;
}

export default function QuizWritingLoadingAnimation({
  duration = 2.4,
  paused = false,
}: QuizWritingLoadingAnimationProps) {
  return (
    <div
      className={`loading-animation quiz-writing-animation${paused ? ' is-paused' : ''}`}
      style={{ '--loading-duration': `${duration}s` } as CSSProperties}
      role="img"
      aria-label="Lápis percorrendo as linhas de uma folha"
    >
      <img
        className="loading-animation-sprite"
        src="/resumex-quiz-writing-frames.png"
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}
