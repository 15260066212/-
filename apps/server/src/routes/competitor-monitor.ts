import { Hono } from 'hono';
import { generateCompetitorReport } from '../services/competitor-monitor.service.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// POST /generate
// ---------------------------------------------------------------------------

app.post('/generate', async (c) => {
  try {
    const body = await c.req.json<{ target: string; competitors: string[] }>();
    const target = body.target?.trim();
    const competitors = (body.competitors || []).filter((s) => s.trim()).map((s) => s.trim());

    if (!target) {
      return c.json({ success: false, error: '请填写公司名称' }, 400);
    }
    if (competitors.length === 0) {
      return c.json({ success: false, error: '请至少填写一个竞品名称' }, 400);
    }

    const report = await generateCompetitorReport(target, competitors);
    return c.json({
      success: true,
      data: report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export function createCompetitorMonitorRoutes() {
  return app;
}
