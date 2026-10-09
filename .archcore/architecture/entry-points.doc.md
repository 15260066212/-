# Entry-point inventory

**Type:** Doc
**Status:** accepted
**Tags:** entry-points, architecture

## HTTP

- `apps/server/src/index.ts` — Hono HTTP server entry point. Creates services, starts schedulers, listens on `PORT` (default 3000).
  - Route prefixes: `/api/auth`, `/api/session`, `/api/articles`, `/api/reviews`, `/api/publish`, `/api/pipeline`, `/api/credentials`, `/api/monitor`, `/api/cookie-harvester`, `/api/competitor-monitor`, `/api/optimization-plan`, `/api/users`
  - Health: `GET /api/health`
  - Cache: `GET /api/cache/stats`, `DELETE /api/cache`

## Workers / Schedulers

All schedulers run in-process within the Hono server (`apps/server/src/scheduler.ts`):

- **Publish scheduler** — polls DB every 30s for pending publish tasks; max 5 concurrent; per-platform cooldown.
- **Health checker** — batch session health validation every 10 minutes via `SessionHealthChecker`.
- **Cookie warmer** — visits platform pages every 2h to refresh saved cookies (requires `RPA_REMOTE_URL`).
- **Cache cleanup** — evicts expired LRU cache entries every 5 minutes.
- **Plan task scheduler** — checks hourly for due scheduled plan tasks (generate + review pipeline).

## RPA Browser

- `harvester/server.js` — Standalone cookie harvester / RPA bridge server (Express + Puppeteer). Deployed separately via Docker.
- `packages/publisher/src/rpa-engine.ts` — RPA engine (Playwright-based) used in-process by the publisher package. Lazy-launches browser on first publish request.

## Frontend

- `apps/web/src/main.tsx` — React SPA entry point. Renders `App.tsx` with Zustand stores and React Router.
