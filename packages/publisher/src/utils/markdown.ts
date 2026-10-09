/**
 * Basic Markdown to HTML conversion utility.
 *
 * This is a lightweight converter for common Markdown syntax used in
 * article publishing. It is intentionally dependency-free to keep the
 * publisher package lightweight.
 *
 * Supported syntax:
 * - Headings: # h1, ## h2, ### h3
 * - Bold: **text**
 * - Italic: *text*
 * - Links: [text](url)
 * - Code blocks: ``` ... ```
 * - Inline code: `code`
 * - Blockquotes: > quote
 * - Unordered lists: - item, * item
 * - Paragraphs (double newline)
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';

  let html = markdown;

  // Code blocks (must be processed before inline patterns)
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```\w*\n?/g, '').replace(/```$/g, '');
    return `<pre><code>${code}</code></pre>`;
  });

  // Headers
  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold and italic (bold first to avoid matching * inside **)
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^[-*+] (.+)$/gm, '<li>$1</li>');

  // Paragraphs (split on double newline, wrap non-block elements in <p>)
  html = html
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      // Already a block-level element — leave as-is
      if (
        trimmed.startsWith('<h') ||
        trimmed.startsWith('<pre') ||
        trimmed.startsWith('<blockquote') ||
        trimmed.startsWith('<li') ||
        trimmed.startsWith('<p>')
      ) {
        return trimmed;
      }
      // Wrap plain text in <p>, preserve single line breaks with <br>
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return html;
}
