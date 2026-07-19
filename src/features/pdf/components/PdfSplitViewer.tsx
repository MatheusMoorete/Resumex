import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const STOP_WORDS = new Set([
  'para', 'como', 'com', 'uma', 'que', 'por', 'das', 'dos', 'nas', 'nos',
  'essa', 'esse', 'isso', 'sao', 'são', 'deve', 'mais', 'menos', 'entre',
  'sobre', 'pagina', 'página', 'conteudos', 'conteúdos', 'principais',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getSearchTokens(sourceText) {
  return normalizeText(sourceText)
    .replace(/[^a-z0-9<>/=+\-°]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
    .slice(0, 28);
}

function getItemRect(item, viewport) {
  const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const x = transform[4];
  const y = transform[5];
  const width = Math.max(item.width * viewport.scale, 8);
  const height = Math.max(Math.abs(item.height * viewport.scale), Math.abs(transform[3]), 10);

  return {
    left: x,
    top: y - height,
    width,
    height: height + 3,
  };
}

export default function PdfSplitViewer({ pdfUrl, activePage = 1, sourceText = '' }) {
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(activePage || 1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [highlights, setHighlights] = useState([]);
  const [fallbackHighlight, setFallbackHighlight] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const searchTokens = useMemo(() => getSearchTokens(sourceText), [sourceText]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    pdfjsLib.getDocument(pdfUrl).promise
      .then((loadedPdf) => {
        if (cancelled) return;
        setPdf(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (activePage) setPageNumber(activePage);
  }, [activePage]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;

    let cancelled = false;

    async function renderPage() {
      setIsLoading(true);
      setHighlights([]);
      setFallbackHighlight(false);

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;

      const containerWidth = canvasRef.current.parentElement?.clientWidth || 720;
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = Math.min(Math.max((containerWidth - 32) / baseViewport.width, 0.8), 1.8);
      const scale = Math.min(Math.max(fitScale * zoom, 0.5), 3);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const renderTask = page.render({ canvasContext: context, viewport });
      renderTaskRef.current = renderTask;

      try {
        await renderTask.promise;
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') throw err;
      }

      if (cancelled) return;

      const textContent = await page.getTextContent();
      if (cancelled) return;

      const matches = [];
      if (searchTokens.length > 0) {
        for (const item of textContent.items) {
          const itemText = normalizeText(item.str);
          const matched = searchTokens.some((token) => itemText.includes(token) || token.includes(itemText));
          if (matched) {
            matches.push(getItemRect(item, viewport));
          }
        }
      }

      setHighlights(matches.slice(0, 80));
      setFallbackHighlight(searchTokens.length > 0 && matches.length === 0);
      setIsLoading(false);
    }

    renderPage().catch(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber, searchTokens, zoom]);

  const goToPage = (nextPage) => {
    if (!numPages) return;
    setPageNumber(Math.min(Math.max(nextPage, 1), numPages));
  };

  const changeZoom = (nextZoom) => {
    setZoom(Math.min(Math.max(nextZoom, 0.6), 2.5));
  };

  return (
    <div className="pdf-split-viewer">
      <div className="pdf-split-toolbar">
        <div className="pdf-toolbar-group">
          <button className="btn btn-ghost" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1}>
            ←
          </button>
          <span className="pdf-split-page-label">
            Página {pageNumber}{numPages ? ` de ${numPages}` : ''}
          </span>
          <button className="btn btn-ghost" onClick={() => goToPage(pageNumber + 1)} disabled={pageNumber >= numPages}>
            →
          </button>
        </div>

        <div className="pdf-toolbar-group">
          <button className="btn btn-ghost" onClick={() => changeZoom(zoom - 0.15)} disabled={zoom <= 0.6}>
            -
          </button>
          <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost" onClick={() => changeZoom(zoom + 0.15)} disabled={zoom >= 2.5}>
            +
          </button>
          <button className="btn btn-secondary" onClick={() => setZoom(1)}>
            Ajustar
          </button>
        </div>
      </div>

      <div className="pdf-canvas-scroll">
        <div className={`pdf-canvas-wrap ${fallbackHighlight ? 'fallback-highlight' : ''}`}>
          <canvas ref={canvasRef} />
          {highlights.map((highlight, index) => (
            <span
              key={`${highlight.left}-${highlight.top}-${index}`}
              className="pdf-highlight-box"
              style={{
                left: `${highlight.left}px`,
                top: `${highlight.top}px`,
                width: `${highlight.width}px`,
                height: `${highlight.height}px`,
              }}
            />
          ))}
          {fallbackHighlight && (
            <span className="pdf-page-highlight-label">
              Referência localizada nesta página; trecho exato não encontrado na camada de texto.
            </span>
          )}
          {isLoading && <span className="pdf-loading-label">Carregando página...</span>}
        </div>
      </div>
    </div>
  );
}
