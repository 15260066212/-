import { Hono } from 'hono';
import { generateManual, generateManualHtml } from '@zemingengine/manual-generator';
import { getSession } from '../session-store.js';
import type { DatabaseAccess } from '../db.js';

export function createManualRoutes(db: DatabaseAccess): Hono {
  const manualRoutes = new Hono();

  // GET /api/session/:id/manual - Get manual content
  manualRoutes.get('/:id/manual', (c) => {
    const id = c.req.param('id');
    const entry = getSession(id, db);
    if (!entry) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    const manual = generateManual(entry.data);

    return c.json({
      success: true,
      data: {
        markdown: manual.markdown,
        filename: manual.filename,
      },
    });
  });

  // GET /api/session/:id/manual/download - Download manual as file
  manualRoutes.get('/:id/manual/download', (c) => {
    const id = c.req.param('id');
    const entry = getSession(id, db);
    if (!entry) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    const format = c.req.query('format') || 'markdown';
    const manual = generateManual(entry.data);

    if (format === 'html') {
      const html = generateManualHtml(entry.data);
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(manual.filename.replace('.md', '.html'))}"`,
        },
      });
    }

    // Default: markdown
    return new Response(manual.markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(manual.filename)}"`,
      },
    });
  });

  return manualRoutes;
}
