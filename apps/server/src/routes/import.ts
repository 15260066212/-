import { Hono } from 'hono';
import type { AppEnv, DatabaseAccess } from '../db.js';
import { getSession, updateSession } from '../session-store.js';
import { analyzePptContent, isAIAvailable, recommendKeywords } from '@zemingengine/ai-engine';
import JSZip from 'jszip';

export function createImportRoutes(db: DatabaseAccess): Hono<AppEnv> {
  const importRoutes = new Hono<AppEnv>();

  importRoutes.post('/:id/import-ppt', async (c) => {
    const id = c.req.param('id');
    const entry = getSession(id, db);
    if (!entry) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return c.json({ success: false, error: 'No file uploaded' }, 400);
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.pptx') && !fileName.endsWith('.ppt')) {
      return c.json({ success: false, error: '仅支持 .pptx 格式文件' }, 400);
    }

    if (fileName.endsWith('.ppt')) {
      return c.json({
        success: false,
        error: '旧版 .ppt 格式不支持，请将文件另存为 .pptx 格式后重试',
      }, 400);
    }

    try {
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);

      const slideFiles = Object.keys(zip.files)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0');
          const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0');
          return numA - numB;
        });

      if (slideFiles.length === 0) {
        return c.json({ success: false, error: 'PPT 文件中没有找到幻灯片内容' }, 400);
      }

      const slideTexts: string[] = [];
      for (const slidePath of slideFiles) {
        const xmlContent = await zip.files[slidePath].async('text');
        const texts = extractTextFromXml(xmlContent);
        slideTexts.push(texts.join('\n'));
      }

      const session = entry.engine.getSession();
      const result = await analyzePptContent(slideTexts, file.name, session);

      const updated = entry.engine.getSession();
      Object.assign(updated.enterprise, result.enterprise);
      updated.currentStage = 'profile';

      if (result.keywords.length > 0) {
        updated.keywords = result.keywords;
      } else {
        try {
          const recommended = await recommendKeywords(updated);
          if (recommended.length > 0) {
            updated.keywords = recommended;
          }
        } catch {
          // keep existing keywords
        }
      }

      entry.engine.setSession(updated);
      updateSession(id, updated, db);

      const analysisMessage = {
        id: `msg_${Date.now()}_ppt_import`,
        role: 'system' as const,
        content: result.summary,
        stage: 'intro' as const,
        timestamp: new Date().toISOString(),
      };

      return c.json({
        success: true,
        data: {
          analysisMessage,
          sessionData: updated,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PPT 解析失败';
      return c.json({ success: false, error: message }, 500);
    }
  });

  return importRoutes;
}

function extractTextFromXml(xml: string): string[] {
  const texts: string[] = [];
  const regex = /<a:t>([^<]*)<\/a:t>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    if (match[1].trim()) {
      texts.push(match[1]);
    }
  }
  return texts;
}
