/**
 * API 路径常量
 *
 * 集中管理前端调用的所有 API 端点路径，避免在多个文件中重复硬编码。
 * 命名约定：
 * - 基础路径（前缀）：以 _BASE 结尾
 * - 完整路径：直接描述功能
 * - 带动态参数的路径：提供构建函数
 */

// === Cookie Harvester ===
export const COOKIE_HARVESTER_BASE = '/api/cookie-harvester';

export const cookieHarvesterPaths = {
  health: `${COOKIE_HARVESTER_BASE}/health`,
  start: `${COOKIE_HARVESTER_BASE}/start`,
  status: (sessionId: string) => `${COOKIE_HARVESTER_BASE}/status/${sessionId}`,
  cookies: (sessionId: string) => `${COOKIE_HARVESTER_BASE}/cookies/${sessionId}`,
  close: (sessionId: string) => `${COOKIE_HARVESTER_BASE}/close/${sessionId}`,
};

// === Optimization Plan ===
export const OPTIMIZATION_PLAN_BASE = '/api/optimization-plan';

export const optimizationPlanPaths = {
  saved: (sessionId: string) => `${OPTIMIZATION_PLAN_BASE}/saved/${sessionId}`,
  generate: `${OPTIMIZATION_PLAN_BASE}/generate`,
};

// === Competitor Monitor ===
export const COMPETITOR_MONITOR_BASE = '/api/competitor-monitor';

export const competitorMonitorPaths = {
  generate: `${COMPETITOR_MONITOR_BASE}/generate`,
};

// === Reviews ===
export const REVIEWS_BASE = '/api/reviews';

export const reviewPaths = {
  manualSave: (articleId: string) => `${REVIEWS_BASE}/${encodeURIComponent(articleId)}/manual-save`,
};
