import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownPreviewProps = {
  content: string;
  onPageClick?: (page: number, source: string) => void;
};

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
 * Pre-processes page references as internal links. React renders the button,
 * so generated Markdown never needs permission to inject raw HTML.
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
      return `[${displayLabel}](#page=${pageNum}&source=${encodeURIComponent(sourceText)})`;
    }
  );
}

export default function MarkdownPreview({ content, onPageClick }: MarkdownPreviewProps) {
  if (!content) {
    return (
      <div className="markdown-body" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-3xl)' }}>
        O resumo aparecerá aqui...
      </div>
    );
  }

  const processedContent = onPageClick ? processPageRefs(content) : content;

  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            if (href?.startsWith('#page=') && onPageClick) {
              const params = new URLSearchParams(href.slice(1));
              const page = Number(params.get('page'));
              if (!Number.isInteger(page) || page < 1) return <>{children}</>;
              return (
                <button
                  type="button"
                  className="page-ref"
                  title={`Ir para a página ${page} no PDF`}
                  onClick={() => onPageClick(page, params.get('source') || '')}
                >
                  {children}
                </button>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
          },
        }}
      >
        {processedContent}
      </Markdown>
    </div>
  );
}
