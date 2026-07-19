/**
 * Copies text to clipboard with fallback support.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    // Modern Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Fallback for older browsers or non-secure contexts
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * Removes page-reference markers used only by the in-app split view.
 * Keeps the Markdown cleaner for Notion.
 * @param {string} markdown
 * @returns {string}
 */
export function stripPageReferences(markdown) {
  if (!markdown) return markdown;

  return markdown
    .replace(/\s*\((?:p\.|página|pág\.?)\s*\d+(?:\s*-\s*\d+)?\)/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
