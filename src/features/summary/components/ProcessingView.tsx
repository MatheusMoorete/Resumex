import React, { useState, useEffect } from 'react';
import NotebookLoadingAnimation from '../../loading/components/NotebookLoadingAnimation';

interface ProcessingViewProps {
  stage?: string;
  progress?: number;
}

const MESSAGES = [
  'Indexando Metadados do Material',
  'Lendo e Organizando o Conteúdo',
  'Conferindo Imagens e Manuscritos',
  'Ajustando Tipografia e Diagramação',
  'Gerando Versão Final com o Resumex'
];

export default function ProcessingView({ stage = 'queued', progress = 0 }: ProcessingViewProps) {
  const isComplete = stage === 'completed';
  const [msgIndex, setMsgIndex] = useState(0);
  const [fadeMsg, setFadeMsg] = useState(true);

  // Rotação dinâmica das mensagens a cada 3.5 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      setFadeMsg(false);
      setTimeout(() => {
        setMsgIndex((prev) => (prev + 1) % MESSAGES.length);
        setFadeMsg(true);
      }, 250);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="summary-processing-section"
      style={{
        minHeight: 'auto',
        padding: '40px 16px',
        border: 'none',
        background: 'transparent',
        boxShadow: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'IBM Plex Sans', Georgia, sans-serif",
        color: '#203229',
        width: '100%'
      }}
    >
      {/* Card Principal - Neo-Brutalist Canvas */}
      <section
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '460px',
          backgroundColor: '#fff8ef',
          border: '2.5px solid #203229',
          boxShadow: '8px 8px 0px 0px #203229',
          padding: '40px 28px 32px',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        {/* Post-it Flutuante Superior */}
        <div
          style={{
            position: 'absolute',
            top: '-22px',
            right: '-20px',
            backgroundColor: '#fed657',
            border: '2px solid #203229',
            boxShadow: '4px 4px 0px 0px #203229',
            padding: '8px 14px',
            transform: 'rotate(3deg)',
            zIndex: 10,
            width: '130px',
            textAlign: 'center'
          }}
        >
          {/* Fita Adesiva do Post-it */}
          <div
            style={{
              position: 'absolute',
              top: '-10px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '36px',
              height: '14px',
              backgroundColor: 'rgba(255, 255, 255, 0.5)',
              border: '1px solid rgba(32, 50, 41, 0.2)'
            }}
          />
          <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.75rem', fontWeight: 700, color: '#4a3a00', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {progress >= 100 ? '✓ Concluído' : progress >= 80 ? 'Quase pronto' : 'Processando'}
          </p>
        </div>

        {/* Animação do Caderno Oficial ResumeX */}
        <div style={{ position: 'relative', width: '100%', height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '-20px', marginBottom: '8px', overflow: 'hidden' }}>
          <div style={{ width: '220px', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'scale(0.68)' }}>
            <NotebookLoadingAnimation duration={0.78} closing={isComplete} />
          </div>
        </div>

        {/* Título Principal de Status */}
        <h2
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: '1.4rem',
            fontWeight: 700,
            color: '#203229',
            textAlign: 'center',
            margin: '8px 0 16px 0'
          }}
        >
          Preparando seu resumo...
        </h2>

        {/* Barra de Progresso Neo-Brutalista */}
        <div style={{ width: '100%', height: '24px', border: '2px solid #203229', backgroundColor: '#fff', padding: '2px', overflow: 'hidden', borderRadius: '2px', marginBottom: '12px' }}>
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              backgroundColor: '#fed657',
              backgroundImage: 'repeating-linear-gradient(-45deg, rgba(32,50,41,0.06), rgba(32,50,41,0.06) 6px, transparent 6px, transparent 12px)',
              transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          />
        </div>

        {/* Labels de Detalhes Rodapé da Barra */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem', color: '#57655d' }}>
          <span style={{ opacity: fadeMsg ? 1 : 0.2, transition: 'opacity 0.25s ease', fontWeight: 600, textTransform: 'uppercase' }}>
            {MESSAGES[msgIndex]}
          </span>
          <span style={{ fontWeight: 700 }}>{progress}%</span>
        </div>
      </section>
    </div>
  );
}
