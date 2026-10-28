/**
 * 浏览器远程控制 - 共享会话存储
 *
 * sessions Map 被 server.ts 导入使用：
 *   - server.ts 创建 WebSocket 服务器并处理 /ws 连接
 *   - server.ts 注册 /remote/:sessionId 路由
 *   - server.ts 的 closeSession 负责清理 sessions.delete()
 *
 * 此文件仅导出 sessions Map，不包含任何服务器逻辑。
 */

import type { Page, BrowserContext } from 'playwright';

export interface RemoteSession {
  page: Page;
  context: BrowserContext;
  platform: string;
  accountName: string;
  userDataDir: string;
}

/** sessionId -> { page, context, platform } */
export const sessions = new Map<string, RemoteSession>();
