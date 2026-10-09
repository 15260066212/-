# Running the project locally

**Type:** Guide
**Status:** accepted
**Tags:** onboarding

## Prerequisites

- Node.js ≥ 22.0.0
- npm ≥ 10.9.2 (defined as packageManager in root package.json)

## Install

```bash
npm install
```

## Develop

```bash
npm run dev
```

Starts both the web frontend (Vite, default port 5173) and the server backend (Hono, default port 3000) concurrently via Turborepo.

## Build

```bash
npm run build
```

Builds all packages and apps in dependency order.

## Test

```bash
npm test
```

Runs Vitest across all workspaces. For coverage: `npm run test:coverage`.

## Lint & Typecheck

```bash
npm run lint
npm run typecheck
```

## Monorepo layout

- `apps/web/` — React SPA frontend (Vite)
- `apps/server/` — Hono BFF + API server (Node.js)
- `packages/shared/` — Shared types, constants, and interfaces (all packages depend on this)
- `packages/ai-engine/` — AI analysis engine (rules + LLM dual mode)
- `packages/content-generator/` — Article content generation
- `packages/content-reviewer/` — Content quality review and scoring
- `packages/dialogue-engine/` — 6-stage guided dialogue state machine
- `packages/publisher/` — Multi-platform publishing via RPA (Playwright)
- `packages/scraper/` — Web scraping (Cheerio + Puppeteer fallback)
- `packages/manual-generator/` — GEO configuration manual generation
- `packages/session-pool/` — Browser session pool for RPA
- `packages/account-vault/` — Secure credential storage

## Environment

Copy `apps/server/.env.example` to `apps/server/.env` and fill in values. The server uses SQLite by default — no external database required for local development.
