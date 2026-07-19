import type { ReactNode } from 'react';

type FicharioPanelHeaderProps = {
  kicker: string;
  title: string;
  description: string;
  titleId?: string;
  aside?: ReactNode;
};

export default function FicharioPanelHeader({ kicker, title, description, titleId, aside }: FicharioPanelHeaderProps) {
  return (
    <header className="fichario-panel-header">
      <div>
        <span className="fichario-panel-kicker">{kicker}</span>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
      </div>
      {aside}
    </header>
  );
}
