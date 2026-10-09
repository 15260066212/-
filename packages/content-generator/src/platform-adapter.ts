import type { PlatformId } from '@zemingengine/shared';

const HTML_PLATFORMS: PlatformId[] = [
  'weixin',
  'baijia',
  'toutiao',
  'bilibili',
  'sohu',
  'netease',
];

const PLAIN_PLATFORMS: PlatformId[] = [];

export function adaptForPlatform(
  platform: PlatformId,
  markdownContent: string,
): {
  contentMarkdown: string;
  contentHtml?: string;
  contentPlain?: string;
} {
  const result: {
    contentMarkdown: string;
    contentHtml?: string;
    contentPlain?: string;
  } = {
    contentMarkdown: markdownContent,
  };

  if (HTML_PLATFORMS.includes(platform)) {
    result.contentHtml = markdownToHtml(markdownContent);
  } else if (PLAIN_PLATFORMS.includes(platform)) {
    result.contentPlain = markdownToPlain(markdownContent);
  }

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function processInline(text: string): string {
  let result = escapeHtml(text);

  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');

  return result;
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,3}\s/.test(line) ||
    /^>\s/.test(line) ||
    /^[-*]\s/.test(line) ||
    /^\d+\.\s/.test(line)
  );
}

function markdownToHtml(markdown: string): string {
  // Process code blocks first (use placeholder to protect content)
  const codeBlocks: string[] = [];
  let text = markdown.replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_match, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`);
    return placeholder;
  });

  const lines = text.split('\n');
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      blocks.push(`<h3>${processInline(line.slice(4))}</h3>`);
      i++;
    } else if (line.startsWith('## ')) {
      blocks.push(`<h2>${processInline(line.slice(3))}</h2>`);
      i++;
    } else if (line.startsWith('# ')) {
      blocks.push(`<h1>${processInline(line.slice(2))}</h1>`);
      i++;
    } else if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(`<blockquote>${processInline(quoteLines.join('\n'))}</blockquote>`);
    } else if (/^[-*]\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        listItems.push(processInline(lines[i].replace(/^[-*]\s/, '')));
        i++;
      }
      blocks.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join('')}</ul>`);
    } else if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        listItems.push(processInline(lines[i].replace(/^\d+\.\s/, '')));
        i++;
      }
      blocks.push(`<ol>${listItems.map((item) => `<li>${item}</li>`).join('')}</ol>`);
    } else if (line.trim() === '') {
      i++;
    } else {
      const paraLines: string[] = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !isBlockStart(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      blocks.push(`<p>${processInline(paraLines.join(' '))}</p>`);
    }
  }

  let html = blocks.join('\n');

  // Restore code blocks
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`__CODE_BLOCK_${idx}__`, block);
  });

  return html;
}

function markdownToPlain(markdown: string): string {
  let text = markdown;

  // Remove code blocks (keep content)
  text = text.replace(/```(?:\w+)?\n([\s\S]*?)```/g, '$1');

  // Remove inline code markers
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove headers
  text = text.replace(/^#{1,3}\s+/gm, '');

  // Remove blockquote markers
  text = text.replace(/^>\s+/gm, '');

  // Remove list markers
  text = text.replace(/^[-*]\s+/gm, '');
  text = text.replace(/^\d+\.\s+/gm, '');

  // Remove bold and italic markers
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  // Limit consecutive empty lines to at most 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export function countWords(content: string): number {
  const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}
