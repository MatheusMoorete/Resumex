import { useMemo, useState } from 'react';
import { formatFileSize } from '../services/pdfExtractor';

const METHODS = [
  { id: 'free', name: 'Livre' },
  { id: 'clinical', name: 'Ficha clínica' },
  { id: 'active-recall', name: 'Recordação ativa' },
  { id: 'cornell', name: 'Método Cornell' },
  { id: 'cheatsheet', name: 'Consulta rápida' },
];

const FORMATS = [
  { id: 'bullets', label: 'Bullet points', desc: 'Organiza conceitos em tópicos rápidos para revisão.' },
  { id: 'text', label: 'Texto corrido', desc: 'Gera explicações em parágrafos mais contínuos.' },
  { id: 'tables', label: 'Tabelas', desc: 'Usa tabelas para comparar critérios, condutas e classificações.' },
  { id: 'qa', label: 'Perguntas e respostas', desc: 'Transforma conteúdo em perguntas para recordação ativa.' },
  { id: 'mnemonics', label: 'Mnemônicos', desc: 'Cria auxiliares de memorização quando o PDF permitir.' },
  { id: 'flashcards', label: 'Flashcards', desc: 'Gera cartões curtos no estilo frente e verso.' },
];

const DETAIL_LEVELS = [
  { id: 'concise', label: 'Conciso', desc: 'Foca no essencial e reduz explicações longas.' },
  { id: 'balanced', label: 'Equilibrado', desc: 'Mantém bom detalhe sem expandir demais.' },
  { id: 'detailed', label: 'Detalhado', desc: 'Inclui explicações, tabelas e pontos finos do material.' },
];

function parsePageRanges(value, totalPages) {
  const pages = new Set();
  const invalid = [];
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    const singleMatch = part.match(/^\d+$/);

    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > end || start < 1 || end > totalPages) {
        invalid.push(part);
        continue;
      }
      for (let page = start; page <= end; page++) pages.add(page);
    } else if (singleMatch) {
      const page = Number(part);
      if (page < 1 || page > totalPages) {
        invalid.push(part);
        continue;
      }
      pages.add(page);
    } else {
      invalid.push(part);
    }
  }

  return { pages: [...pages].sort((a, b) => a - b), invalid };
}

function uniqueSortedPages(pages) {
  return [...new Set(pages)].sort((a, b) => a - b);
}

export default function PreferencesPanel({
  fileData,
  deepseekKey,
  zhipuKey,
  deepseekAvailable,
  zhipuAvailable,
  onOpenApiKeyModal,
  onContinue,
  onBack,
}) {
  const [readHandwriting, setReadHandwriting] = useState(true);
  const [handwritingMode, setHandwritingMode] = useState('manual');
  const [manualPagesInput, setManualPagesInput] = useState('');
  const [method, setMethod] = useState('free');
  const [formats, setFormats] = useState(['bullets', 'tables']);
  const [detailLevel, setDetailLevel] = useState('balanced');

  const detectedVisionPages = useMemo(() => (
    fileData.pageMetadata
      ? fileData.pageMetadata.filter((page) => page.needsVision).map((page) => page.pageNum)
      : []
  ), [fileData.pageMetadata]);

  const parsedManualPages = useMemo(
    () => parsePageRanges(manualPagesInput, fileData.numPages),
    [manualPagesInput, fileData.numPages]
  );

  const pagesSentToGlm = useMemo(() => {
    if (!readHandwriting) return [];
    if (handwritingMode === 'all') {
      return Array.from({ length: fileData.numPages }, (_, index) => index + 1);
    }
    if (handwritingMode === 'manual') {
      return uniqueSortedPages([...detectedVisionPages, ...parsedManualPages.pages]);
    }
    return detectedVisionPages;
  }, [readHandwriting, handwritingMode, fileData.numPages, detectedVisionPages, parsedManualPages.pages]);

  const toggleFormat = (id) => {
    setFormats((prev) =>
      prev.includes(id) ? prev.filter((format) => format !== id) : [...prev, id]
    );
  };

  const getRequiredKeyMissing = () => {
    const missing = [];
    if (!(zhipuAvailable ?? !!zhipuKey)) missing.push('Zhipu AI');
    if (!(deepseekAvailable ?? !!deepseekKey)) missing.push('DeepSeek');
    return missing.length > 0 ? missing.join(' e ') : null;
  };

  const missingKeyName = getRequiredKeyMissing();
  const isKeyMissing = !!missingKeyName;
  const hasInvalidManualPages = parsedManualPages.invalid.length > 0;

  const handleContinue = () => {
    onContinue({
      provider: 'glm-deepseek',
      readHandwriting,
      handwritingMode,
      manualVisionPages: parsedManualPages.pages,
      method: METHODS.find((item) => item.id === method),
      formats: FORMATS.filter((format) => formats.includes(format.id)),
      source: { id: 'pdf-only', label: 'Apenas o PDF' },
      detailLevel: DETAIL_LEVELS.find((item) => item.id === detailLevel),
    });
  };

  return (
    <div className="prefs-section">
      <div className="prefs-content prefs-compact">
        <div className="prefs-file-summary">
          <div>
            <div className="prefs-kicker">Arquivo</div>
            <div className="prefs-file-title">{fileData.name}</div>
            <div className="prefs-file-meta">
              {fileData.numPages} {fileData.numPages === 1 ? 'página' : 'páginas'} · {formatFileSize(fileData.size)}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onBack}>Trocar arquivo</button>
        </div>

        <section className="prefs-panel">
          <div className="prefs-panel-header">
            <div>
              <h2>Leitura visual</h2>
              <p>Defina quais páginas serão enviadas ao GLM para capturar caneta, setas, imagens e fluxogramas.</p>
            </div>
            <label className="prefs-switch">
              <input
                type="checkbox"
                checked={readHandwriting}
                onChange={(event) => setReadHandwriting(event.target.checked)}
              />
              <span>Ativa</span>
            </label>
          </div>

          {readHandwriting && (
            <>
              <div className="prefs-segmented">
                <button
                  type="button"
                  className={handwritingMode === 'auto' ? 'selected' : ''}
                  onClick={() => setHandwritingMode('auto')}
                  data-tooltip="Usa o detector local para enviar ao GLM só páginas com provável imagem, tabela complexa ou manuscrito."
                >
                  Automático
                </button>
                <button
                  type="button"
                  className={handwritingMode === 'manual' ? 'selected' : ''}
                  onClick={() => setHandwritingMode('manual')}
                  data-tooltip="Você informa as páginas onde escreveu. Melhor equilíbrio entre custo, tempo e qualidade."
                >
                  Informar páginas
                </button>
                <button
                  type="button"
                  className={handwritingMode === 'all' ? 'selected' : ''}
                  onClick={() => setHandwritingMode('all')}
                  data-tooltip="Envia todas as páginas ao GLM. Mais fiel, mas mais lento e caro."
                >
                  Todas
                </button>
              </div>

              {handwritingMode === 'manual' && (
                <div className="prefs-field-row">
                  <label htmlFor="manual-pages-input">Páginas com caneta</label>
                  <input
                    id="manual-pages-input"
                    className="input"
                    value={manualPagesInput}
                    onChange={(event) => setManualPagesInput(event.target.value)}
                    placeholder="Ex: 1, 2, 5-7"
                  />
                </div>
              )}

              <div className="prefs-estimate">
                <span>{pagesSentToGlm.length} páginas serão lidas por visão</span>
                <span>Detectadas: {detectedVisionPages.length ? detectedVisionPages.join(', ') : 'nenhuma'}</span>
              </div>

              {hasInvalidManualPages && (
                <div className="prefs-inline-error">
                  Entrada inválida: {parsedManualPages.invalid.join(', ')}. Use números entre 1 e {fileData.numPages}.
                </div>
              )}
            </>
          )}
        </section>

        <section className="prefs-panel prefs-grid-panel">
          <div>
            <h2>Resumo</h2>
            <p>Escolha a estrutura e os blocos que devem aparecer no resultado.</p>
          </div>

          <div className="prefs-field-row">
            <label htmlFor="method-select">Método</label>
            <select
              id="method-select"
              className="input"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {METHODS.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>

          <div className="prefs-chip-grid compact">
            {FORMATS.map((format) => (
              <button
                key={format.id}
                className={`prefs-chip ${formats.includes(format.id) ? 'selected' : ''}`}
                onClick={() => toggleFormat(format.id)}
                type="button"
                data-tooltip={format.desc}
              >
                {format.label}
              </button>
            ))}
          </div>
        </section>

        <section className="prefs-panel">
          <div>
            <h2>Profundidade</h2>
            <p>Controle o nível de detalhe do resumo final.</p>
          </div>
          <div className="prefs-segmented">
            {DETAIL_LEVELS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={detailLevel === item.id ? 'selected' : ''}
                onClick={() => setDetailLevel(item.id)}
                data-tooltip={item.desc}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {isKeyMissing && (
          <div className="upload-error prefs-key-warning">
            A chave de API do {missingKeyName} não está configurada.{' '}
            <button onClick={onOpenApiKeyModal}>
              Configurar chave
            </button>
          </div>
        )}

        <div className="prefs-actions compact">
          <button className="btn btn-secondary" onClick={onBack}>
            Voltar
          </button>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleContinue}
            disabled={isKeyMissing || (handwritingMode === 'manual' && hasInvalidManualPages)}
            id="continue-to-spec"
          >
            Gerar plano · {pagesSentToGlm.length} páginas com visão
          </button>
        </div>
      </div>
    </div>
  );
}
