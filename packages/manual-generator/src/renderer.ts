import type { SessionData } from '@zemingengine/shared';
import { renderManual } from './template.js';

export interface ManualOutput {
  markdown: string;
  filename: string;
  mimeType: string;
}

export function generateManual(session: SessionData): ManualOutput {
  const markdown = renderManual(session);
  const safeName = (session.promotionGoal.productName || session.enterprise.shortName || session.enterprise.fullName || 'zemingengine')
    .replace(/[^a-zA-Z0-9一-鿿]/g, '_')
    .slice(0, 30);
  const date = new Date().toISOString().slice(0, 10);

  return {
    markdown,
    filename: `芯图引擎GEO_产品推广实操手册_${safeName}_${date}.md`,
    mimeType: 'text/markdown',
  };
}

export function generateManualHtml(session: SessionData): string {
  const markdown = renderManual(session);
  // Simple markdown to HTML conversion
  const html = markdown
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\| (.+) \|$/gm, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>芯图引擎：GEO 产品推广实操手册 - ${session.promotionGoal.productName || session.enterprise.fullName || '未命名'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.8; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
    h2 { color: #1e40af; margin-top: 30px; }
    h3 { color: #374151; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    td, th { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
    th { background: #f9fafb; font-weight: 600; }
    blockquote { border-left: 4px solid #3b82f6; margin: 16px 0; padding: 12px 20px; background: #eff6ff; color: #1e40af; }
    li { margin: 4px 0; }
    strong { color: #111827; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 30px 0; }
  </style>
</head>
<body>
<p>${html}</p>
</body>
</html>`;
}
