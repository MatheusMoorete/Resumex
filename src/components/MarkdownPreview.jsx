import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cleanSourceText(value) {
  return value
    .replace(/\((?:p\.|página|pág\.?)\s*\d+(?:\s*-\s*\d+)?\)/gi, '')
    .replace(/[`*_>#|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getReferenceContext(markdown, offset) {
  const lineStart = markdown.lastIndexOf('\n', offset) + 1;
  const lineEnd = markdown.indexOf('\n', offset);
  const line = markdown.slice(lineStart, lineEnd === -1 ? markdown.length : lineEnd);
  return cleanSourceText(line);
}

/**
 * Pre-processes markdown to convert page references (p. X) into clickable buttons.
 * These buttons will be rendered as HTML via rehype-raw.
 */
function processPageRefs(markdown) {
  if (!markdown) return markdown;

  // Match patterns: (p. 3), (p. 3-5), (p. 12), (Página 3), (Pág. 3)
  return markdown.replace(
    /\((p\.\s*(\d+)(?:\s*-\s*(\d+))?)\)/gi,
    (match, label, page1, page2, offset, fullText) => {
      const pageNum = parseInt(page1, 10);
      const displayLabel = page2 ? `p. ${page1}-${page2}` : `p. ${page1}`;
      const sourceText = getReferenceContext(fullText, offset);
      return `<button class="page-ref" data-page="${pageNum}" data-source="${escapeHtmlAttr(sourceText)}" title="Ir para a página ${pageNum} no PDF">${displayLabel}</button>`;
    }
  );
}

export default function MarkdownPreview({ content, onPageClick }) {
  if (!content) {
    return (
      <div className="markdown-body" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-3xl)' }}>
        O resumo aparecerá aqui...
      </div>
    );
  }

  const processedContent = onPageClick ? processPageRefs(content) : content;

  const handleClick = (e) => {
    // Event delegation: check if a .page-ref button was clicked
    const pageRef = e.target.closest('.page-ref');
    if (pageRef && onPageClick) {
      const page = parseInt(pageRef.dataset.page, 10);
      if (!isNaN(page)) {
        onPageClick(page, pageRef.dataset.source || '');
      }
    }
  };

  return (
    <div className="markdown-body" onClick={handleClick}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {processedContent}
      </Markdown>
    </div>
  );
}
