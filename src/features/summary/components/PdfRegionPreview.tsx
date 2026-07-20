import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Region = [number, number, number, number];

type Props = {
  pdfUrl: string;
  pageNumber: number;
  bbox?: Region | null;
  onOpen: () => void;
};

function normalizedRegion(bbox?: Region | null): Region {
  if (!bbox) return [0, 0, 1, 1];
  const [left, top, right, bottom] = bbox;
  const marginX = Math.max((right - left) * 0.18, 0.025);
  const marginY = Math.max((bottom - top) * 0.35, 0.025);
  return [
    Math.max(0, left - marginX),
    Math.max(0, top - marginY),
    Math.min(1, right + marginX),
    Math.min(1, bottom + marginY),
  ];
}

export default function PdfRegionPreview({ pdfUrl, pageNumber, bbox, onOpen }: Props) {
  const [imageUrl, setImageUrl] = useState('');
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let document: any = null;

    async function renderRegion() {
      document = await pdfjsLib.getDocument(pdfUrl).promise;
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = window.document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      renderTaskRef.current = page.render({ canvasContext: context, viewport });
      await renderTaskRef.current.promise;
      if (cancelled) return;

      const [left, top, right, bottom] = normalizedRegion(bbox);
      const sourceX = Math.floor(left * canvas.width);
      const sourceY = Math.floor(top * canvas.height);
      const sourceWidth = Math.max(1, Math.ceil((right - left) * canvas.width));
      const sourceHeight = Math.max(1, Math.ceil((bottom - top) * canvas.height));
      const crop = window.document.createElement('canvas');
      crop.width = sourceWidth;
      crop.height = sourceHeight;
      crop.getContext('2d')?.drawImage(
        canvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight
      );
      setImageUrl(crop.toDataURL('image/jpeg', 0.86));
    }

    renderRegion().catch(() => {
      if (!cancelled) setImageUrl('');
    });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      document?.destroy?.();
    };
  }, [bbox, pageNumber, pdfUrl]);

  return (
    <button
      type="button"
      className="pdf-region-trigger"
      onClick={onOpen}
      aria-label={`Ver trecho da página ${pageNumber} e responder à dúvida`}
    >
      {imageUrl ? (
        <>
          <img className="pdf-region-thumb" src={imageUrl} alt={`Trecho da página ${pageNumber}`} />
          <span className="pdf-region-hovercard" aria-hidden="true">
            <img src={imageUrl} alt="" />
            <strong>Clique para conferir e responder</strong>
          </span>
        </>
      ) : (
        <span className="pdf-region-loading">Preparando trecho da página {pageNumber}…</span>
      )}
    </button>
  );
}
