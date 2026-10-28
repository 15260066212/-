import { Hono } from 'hono';
import type { AppEnv, DatabaseAccess } from '../db.js';
import { getSession, updateSession } from '../session-store.js';
import { analyzeDocxContent, analyzePptContent, recommendKeywords } from '@zemingengine/ai-engine';
import JSZip from 'jszip';

type ImportAnalysisResult = Awaited<ReturnType<typeof analyzePptContent>>;

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
      const data = await applyDocumentAnalysis(id, entry, db, result, 'ppt_import');

      return c.json({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PPT 解析失败';
      return c.json({ success: false, error: message }, 500);
    }
  });

  importRoutes.post('/:id/import-docx', async (c) => {
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
    if (fileName.endsWith('.doc')) {
      return c.json({
        success: false,
        error: '旧版 .doc 格式不支持，请将文件另存为 .docx 格式后重试',
      }, 400);
    }
    if (!fileName.endsWith('.docx')) {
      return c.json({ success: false, error: '仅支持 .docx 格式文件' }, 400);
    }

    try {
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);

      const documentFile = zip.file('word/document.xml');
      if (!documentFile) {
        return c.json({ success: false, error: 'Word 文件中没有找到正文内容' }, 400);
      }

      const xmlContent = await documentFile.async('text');
      const paragraphs = extractParagraphsFromDocxXml(xmlContent);
      if (paragraphs.length === 0) {
        return c.json({ success: false, error: 'Word 文件中没有提取到文本内容' }, 400);
      }

      const session = entry.engine.getSession();
      const result = await analyzeDocxContent(paragraphs, file.name, session);
      const data = await applyDocumentAnalysis(id, entry, db, result, 'docx_import');

      return c.json({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Word 文档解析失败';
      return c.json({ success: false, error: message }, 500);
    }
  });

  return importRoutes;
}

async function applyDocumentAnalysis(
  id: string,
  entry: NonNullable<ReturnType<typeof getSession>>,
  db: DatabaseAccess,
  result: ImportAnalysisResult,
  messageSuffix: string,
) {
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
    id: `msg_${Date.now()}_${messageSuffix}`,
    role: 'system' as const,
    content: result.summary,
    stage: 'intro' as const,
    timestamp: new Date().toISOString(),
  };

  return {
    analysisMessage,
    sessionData: updated,
  };
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

/** 从 word/document.xml 中按段落提取文本 */
function extractParagraphsFromDocxXml(xml: string): string[] {
  const paragraphs: string[] = [];
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let paragraph;
  while ((paragraph = paragraphRegex.exec(xml)) !== null) {
    const inner = paragraph[1];
    const textRegex = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
    let text;
    const parts: string[] = [];
    while ((text = textRegex.exec(inner)) !== null) {
      parts.push(text[1]);
    }
    const line = decodeXmlEntities(parts.join('')).trim();
    if (line) {
      paragraphs.push(line);
    }
  }
  return paragraphs;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
