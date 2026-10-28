/**
 * Harvester service entry point.
 *
 * Original 2700-line monolith split into focused modules:
 *   config/         - shared state, constants, credential helpers
 *   config/platforms.ts - platform URLs, names, selectors, login config
 *   routes/remote.ts    - GET /remote/:sessionId (WebSocket control page)
 *   routes/session.ts   - POST/GET /api/session/* (start, status, cookies, close)
 *   routes/info.ts      - GET /api/platforms, /api/sessions, /api/credentials/*, /health
 *   routes/rpa.ts       - POST /api/rpa/* (check-session, refresh-cookies, relogin, etc.)
 *   routes/publish.ts   - POST /rpa/publish, /api/llmwiki/publish
 *   remote-browser.ts   - shared sessions Map for WebSocket control
 *   remote-actions/     - domain-split WebSocket message handlers
 *     types.ts          - shared types, StreamState, QUALITY_MODES, INPUT_HELPERS_JS
 *     stream-actions.ts - startStream, stopStream, setQuality, frame, dragStart, dragEnd, sendFrame
 *     mouse-actions.ts  - click, mousedown, mouseup, mousemove, dblclick, rightclick, scroll
 *     input-actions.ts  - keydown, keyup, typeText, pasteText, fillInputAt
 *     nav-actions.ts    - refresh, back, extractCookies
 */

import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { PORT, remoteSessions, CREDENTIALS_FILE, MAIN_SERVER_URL } from './config/index.js';
import { registerRemoteRoute } from './routes/remote.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerInfoRoutes } from './routes/info.js';
import { registerRpaRoutes } from './routes/rpa.js';
import { registerPublishRoutes } from './routes/publish.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { NodeAgent } from './services/node-agent.js';
import os from 'node:os';

import { createStreamState } from './remote-actions/types.js';
import { handleStreamActions, stopStreaming } from './remote-actions/stream-actions.js';
import { handleMouseActions } from './remote-actions/mouse-actions.js';
import { handleInputActions } from './remote-actions/input-actions.js';
import { handleNavActions } from './remote-actions/nav-actions.js';

import type { Express } from 'express';
import type { Server as HttpServer } from 'node:http';
import type { WebSocket } from 'ws';
import type { ActionContext, StreamState } from './remote-actions/types.js';

export const app: Express = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Register all route modules
registerRemoteRoute(app);
registerSessionRoutes(app);
registerInfoRoutes(app);
registerRpaRoutes(app);
registerPublishRoutes(app);
registerProfileRoutes(app);

// ESM equivalent of require.main === module
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const server: HttpServer = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const sessionId = url.searchParams.get('session');

    if (!sessionId || !remoteSessions.has(sessionId)) {
      ws.close();
      return;
    }

    const session = remoteSessions.get(sessionId)!;
    const page = session.page;

    // All stream-related state held in one mutable object, passed by reference
    // to action handlers so they can read and update it directly.
    const state: StreamState = createStreamState();

    // Build the action context once — shared by all handler invocations
    const ctx: ActionContext = { page, session, ws, state };

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        // Dispatch to domain handlers in priority order.
        // Each handler returns `true` if it consumed the message.
        if (await handleStreamActions(msg.type, msg, ctx)) return;
        if (await handleMouseActions(msg.type, msg, ctx)) return;
        if (await handleInputActions(msg.type, msg, ctx)) return;
        if (await handleNavActions(msg.type, msg, ctx)) return;

        // Unknown message types are silently ignored
      } catch (e: unknown) {
        const err = e as Error;
        console.error('[remote] Error handling message:', err.message);
      }
    });

    ws.on('close', () => {
      stopStreaming(state);
      console.log(`[remote] Client disconnected for session ${sessionId}`);
    });

    console.log(`[remote] Client connected for session ${sessionId}`);
  });

  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[Harvester] Cookie harvesting service running on port ${PORT}`);
    console.log(`[Harvester] Credentials storage: ${CREDENTIALS_FILE}`);
    console.log(`[Harvester] LLMWiki publish endpoint: POST /api/llmwiki/publish`);

    // Start node agent (cloud deployment control)
    // Set NODE_AGENT_ENABLED=true and MAIN_SERVER_URL to enable
    if (process.env.NODE_AGENT_ENABLED === 'true' && MAIN_SERVER_URL) {
      const nodeId = process.env.NODE_ID || `${os.hostname()}-harvester-${PORT}`;
      const nodeName = process.env.NODE_NAME || os.hostname();
      const endpoint = process.env.NODE_ENDPOINT || `http://${os.hostname()}:${PORT}`;
      const tags = process.env.NODE_TAGS?.split(',').map((t) => t.trim()).filter(Boolean) || [];

      const agent = new NodeAgent({
        mainServerUrl: MAIN_SERVER_URL,
        nodeId,
        nodeName,
        endpoint,
        version: process.env.npm_package_version || '1.0.0',
        tags,
        deployScript: process.env.DEPLOY_SCRIPT_PATH,
        projectDir: process.cwd(),
      });

      agent.start().catch((err) => {
        console.error('[Harvester] Node agent failed to start:', err.message);
      });

      console.log(`[Harvester] Node agent enabled (id: ${nodeId})`);
    }
  });
}
