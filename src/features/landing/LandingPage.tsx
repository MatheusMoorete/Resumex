import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './LandingPage.css';

const sectionByRoute: Record<string, string> = {
  '/como-funciona': 'como-funciona',
  '/medicina': 'contexto',
  '/recursos': 'recursos',
  '/planos': 'planos',
};

const tools = [
  ['01', 'Resumo', 'Organiza o conteúdo com estrutura clínica e referência por página.'],
  ['02', 'Simulado', 'Transforma o material em questões para testar compreensão e retenção.'],
  ['03', 'Flashcards', 'Separa conceitos que precisam voltar no momento certo da revisão.'],
];

const plans = [
  {
    name: 'Essencial',
    price: 'R$ 19',
    description: 'Para organizar materiais pontuais ao longo do mês.',
    features: ['Resumos com referências', 'Simulados e flashcards', 'Até 10 materiais por mês'],
  },
  {
    name: 'Rotina',
    price: 'R$ 39',
    description: 'Para quem usa o Resumex como parte da rotina de estudos.',
    features: ['Tudo do plano Essencial', 'Até 30 materiais por mês', 'Mais espaço para revisões'],
    featured: true,
  },
  {
    name: 'Intensivo',
    price: 'R$ 69',
    description: 'Para ciclos de prova e períodos com maior volume de conteúdo.',
    features: ['Tudo do plano Rotina', 'Até 100 materiais por mês', 'Processamento prioritário'],
  },
];

export default function LandingPage() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = 'Resumex — contexto médico para o seu estudo';

    const sections = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sections.forEach((section) => section.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sectionId = sectionByRoute[pathname];
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.requestAnimationFrame(() => {
      if (sectionId) document.getElementById(sectionId)?.scrollIntoView({ behavior });
      else window.scrollTo({ top: 0, behavior });
    });
  }, [pathname]);

  return (
    <div className="lp-page">
      <header className="lp-header">
        <Link className="lp-logo" to="/" aria-label="Resumex, página inicial">resumex<span>!</span></Link>
        <nav aria-label="Navegação principal">
          <Link to="/como-funciona">Como funciona</Link>
          <Link to="/medicina">Por que é diferente</Link>
          <Link to="/planos">Planos</Link>
          <Link className="lp-login-link" to="/planos">Assinar <span>→</span></Link>
        </nav>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="lp-title">
          <div className="lp-hero-copy">
            <span className="lp-stamp">OTIMIZADO PARA MEDICINA</span>
            <h1 id="lp-title">Menos tempo<br />organizando.<br /><em>Mais tempo estudando.</em></h1>
            <p>
              O Resumex transforma seus PDFs em materiais de estudo direcionados ao contexto médico — com estrutura, referências e ferramentas para revisar.
            </p>
            <div className="lp-hero-actions">
              <Link className="lp-primary-action" to="/app">Abrir minha mesa <span>→</span></Link>
              <Link className="lp-text-link" to="/como-funciona">Entender o processo ↓</Link>
            </div>
          </div>

          <div className="lp-workbench" aria-label="Representação do fluxo de estudo no Resumex">
            <span className="lp-workbench-clip">MATERIAL #024</span>
            <div className="lp-study-sheet lp-summary-sheet">
              <span>01 / RESUMO</span>
              <strong>Traumatismo cranioencefálico</strong>
              <p>Critérios, achados e condutas organizados com a página de origem.</p>
              <small>p. 14 ↗</small>
            </div>
            <div className="lp-study-sheet lp-quiz-sheet">
              <span>02 / SIMULADO</span>
              <strong>Quando está indicada a monitorização da PIC?</strong>
              <p>A. Glasgow ≤ 8<br />B. Glasgow 13–15<br />C. Apenas em idosos</p>
              <small>RESPONDER →</small>
            </div>
            <div className="lp-study-sheet lp-flashcard-sheet">
              <span>03 / FLASHCARD</span>
              <strong>PIC &gt; 22 mmHg</strong>
              <p>Qual limiar indica tratamento?</p>
              <small>VIRAR →</small>
            </div>
            <div className="lp-workbench-note">conteúdo certo<br /><b>→ no lugar certo</b></div>
          </div>
        </section>

        <div className="lp-ticker" aria-hidden="true">
          <span>PDFS MÉDICOS</span><b>✳</b><span>CONTEXTO CLÍNICO</span><b>✳</b><span>REVISÃO ATIVA</span><b>✳</b><span>REFERÊNCIAS POR PÁGINA</span>
        </div>

        <section className="lp-process" id="como-funciona" aria-labelledby="process-title" data-reveal>
          <header className="lp-section-heading">
            <span>COMO FUNCIONA / 03 ETAPAS</span>
            <h2 id="process-title">Do PDF à revisão,<br />sem trabalho manual.</h2>
          </header>
          <ol className="lp-process-grid">
            <li>
              <span>01 / MATERIAL</span>
              <h3>Coloque os PDFs na mesa</h3>
              <p>Envie até cinco arquivos. Texto, páginas escaneadas e anotações podem fazer parte do mesmo material.</p>
            </li>
            <li>
              <span>02 / DIREÇÃO</span>
              <h3>Escolha como estudar</h3>
              <p>Defina profundidade, formato e método. O conteúdo passa a seguir um objetivo, não apenas um prompt aberto.</p>
            </li>
            <li>
              <span>03 / REVISÃO</span>
              <h3>Estude com rastreabilidade</h3>
              <p>Revise resumos, responda simulados ou pratique flashcards sem perder a ligação com o material original.</p>
            </li>
          </ol>
        </section>

        <section className="lp-context" id="contexto" aria-labelledby="context-title" data-reveal>
          <div className="lp-context-copy">
            <span className="lp-stamp">CONTEXTO, NÃO CONVERSA GENÉRICA</span>
            <h2 id="context-title">Um chat responde.<br /><em>O Resumex direciona.</em></h2>
            <p>
              Ferramentas genéricas deixam para você o trabalho de explicar toda vez o que precisa. Aqui, o fluxo já foi construído para material médico: organizar critérios, preservar valores, separar condutas e apontar de onde cada informação veio.
            </p>
          </div>
          <dl className="lp-context-list">
            <div><dt>Referência por página</dt><dd>Volte à fonte sem procurar o PDF inteiro.</dd></div>
            <div><dt>Estrutura clínica</dt><dd>Definições, critérios, achados e condutas no lugar esperado.</dd></div>
            <div><dt>Revisão de risco</dt><dd>Valores e manuscritos incertos pedem confirmação em vez de virar certeza.</dd></div>
            <div><dt>Um fluxo contínuo</dt><dd>Resumo, teste e flashcards partem do mesmo contexto.</dd></div>
          </dl>
        </section>

        <section className="lp-tools" id="recursos" aria-labelledby="tools-title" data-reveal>
          <header className="lp-section-heading">
            <span>UMA BASE / TRÊS FORMAS DE ESTUDAR</span>
            <h2 id="tools-title">O material muda de forma.<br />O contexto permanece.</h2>
          </header>
          <div className="lp-tools-grid">
            {tools.map(([number, title, description]) => (
              <article key={title}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-pricing" id="planos" aria-labelledby="pricing-title" data-reveal>
          <header className="lp-section-heading">
            <span>PLANOS / ESCOLHA O SEU RITMO</span>
            <div>
              <h2 id="pricing-title">Uma opção para cada<br />momento do estudo.</h2>
              <p className="lp-pricing-note">Valores provisórios. Os planos ainda não estão disponíveis para contratação.</p>
            </div>
          </header>
          <div className="lp-pricing-grid">
            {plans.map((plan) => (
              <article className={plan.featured ? 'lp-plan-featured' : undefined} key={plan.name}>
                {plan.featured && <span className="lp-plan-label">MAIS EQUILIBRADO</span>}
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <strong>{plan.price}<small>/mês</small></strong>
                <ul>
                  {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
                <span className="lp-plan-action">EM BREVE</span>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-final" data-reveal>
          <span>OTIMIZE O PROCESSO, NÃO O APRENDIZADO.</span>
          <h2>Seu tempo deve ir para entender medicina.</h2>
          <p>Deixe a organização do material com o Resumex.</p>
          <Link className="lp-primary-action" to="/planos">Assinar <span>→</span></Link>
        </section>
      </main>

      <footer className="lp-footer">
        <Link className="lp-logo" to="/">resumex<span>!</span></Link>
        <p>Organização e revisão para estudo médico.</p>
        <span>© 2026</span>
      </footer>
    </div>
  );
}
