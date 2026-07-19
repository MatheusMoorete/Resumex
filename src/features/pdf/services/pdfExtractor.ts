import * as pdfjsLib from 'pdfjs-dist';

type PageMetadata = {
  pageNum: number;
  text: string;
  needsVision: boolean;
};

type RenderPdfOptions = {
  scale?: number;
  quality?: number;
  format?: string;
  maxPages?: number;
  pageNumbersToRender?: number[] | null;
  onProgress?: (progress: { current: number; total: number }) => void;
};

// Use CDN worker for simplicity in the MVP
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

/**
 * Helper to detect if a PDF page requires multimodal vision analysis.
 * Uses three heuristics: text length, ink annotations (stylus drawing), and image rendering operators.
 */
async function detectVisionNeed(page: any, text: string) {
  // Heuristic 1: Text is very short (less than 150 chars)
  if (!text || text.trim().length < 150) {
    return true;
  }

  // Heuristic 2: Has ink/stylus annotations
  try {
    const annotations = await page.getAnnotations();
    const hasHandwriting = annotations.some(ann => 
      ann.subtype === 'Ink' || 
      ann.subtype === 'Line' || 
      ann.type === 'ink' ||
      ann.annotationType === 15 // INK type code in pdfjs
    );
    if (hasHandwriting) return true;
  } catch (e) {
    console.warn('Error reading annotations for page vision detection:', e);
  }

  // Heuristic 3: Scans for image/graphics drawing operators
  try {
    const operatorList = await page.getOperatorList();
    const OPS = (pdfjsLib.OPS || {}) as Record<string, number>;
    
    // Function codes for image rendering in PDF.js
    const paintImage = OPS.paintImageXObject !== undefined ? OPS.paintImageXObject : 82;
    const paintInline = OPS.paintInlineImageXObject !== undefined ? OPS.paintInlineImageXObject : 83;
    const paintMask = OPS.paintImageMaskXObject !== undefined ? OPS.paintImageMaskXObject : 85;

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const fn = operatorList.fnArray[i];
      if (fn === paintImage || fn === paintInline || fn === paintMask) {
        return true;
      }
    }
  } catch (e) {
    console.warn('Error reading operator list for page vision detection:', e);
  }

  return false;
}

/**
 * Extracts text from a PDF file page by page and detects vision needs.
 * @param {File} file
 * @returns {Promise<{text: string, numPages: number, pageTexts: string[], pageMetadata: Array}>}
 */
export async function extractTextFromPDF(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const numPages = pdf.numPages;
  const pageTexts: string[] = [];
  const pageMetadata: PageMetadata[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    let lastY = null;
    let pageText = '';

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      if (item.str.trim() === '') continue;
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
        pageText += '\n';
      } else if (lastY !== null) {
        pageText += ' ';
      }
      pageText += item.str;
      lastY = item.transform[5];
    }

    const trimmedText = pageText.trim();
    pageTexts.push(trimmedText);

    // Run vision detection heuristics
    const needsVision = await detectVisionNeed(page, trimmedText);

    pageMetadata.push({
      pageNum: i,
      text: trimmedText,
      needsVision,
    });
  }

  const fullText = pageTexts
    .map((text, index) => `--- Página ${index + 1} ---\n${text}`)
    .join('\n\n');

  return {
    text: fullText,
    numPages,
    pageTexts,
    pageMetadata,
  };
}

/**
 * Renders specific PDF pages as JPEG images (base64).
 *
 * @param {File} file - The PDF file
 * @param {Object} [options]
 * @param {number} [options.scale=1.0] - Render scale
 * @param {number} [options.quality=0.92] - Image quality
 * @param {string} [options.format='image/png'] - Output image format
 * @param {number} [options.maxPages=60] - Max pages to render
 * @param {number[]} [options.pageNumbersToRender] - Optional list of 1-based page numbers to render
 * @param {(progress: {current: number, total: number}) => void} [options.onProgress]
 * @returns {Promise<{images: Object, numPages: number}>} - Object mapping pageNum -> base64 data URL
 */
export async function renderPDFPagesToImages(file: File, options: RenderPdfOptions = {}) {
  const {
    scale = 1.0,
    quality = 0.92,
    format = 'image/png',
    maxPages = 60,
    pageNumbersToRender = null,
    onProgress,
  } = options;

  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const numPages = Math.min(pdf.numPages, maxPages);
  const images: Record<number, string> = {};

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D não está disponível neste navegador.');

  // Determine which page numbers to render
  const pagesToRender = pageNumbersToRender || Array.from({ length: numPages }, (_, i) => i + 1);
  const totalToRender = pagesToRender.length;

  for (let i = 0; i < totalToRender; i++) {
    const pageNum = pagesToRender[i];
    if (pageNum > numPages) continue;

    if (onProgress) {
      onProgress({ current: i + 1, total: totalToRender });
    }

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    const imageDataUrl = canvas.toDataURL(format, quality);
    images[pageNum] = imageDataUrl;
  }

  canvas.width = 0;
  canvas.height = 0;

  return {
    images,
    numPages: pdf.numPages,
  };
}

/**
 * Gets the file size in a human-readable format.
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
