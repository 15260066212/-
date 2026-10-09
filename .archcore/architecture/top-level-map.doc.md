# Top-level architecture map

**Type:** Doc
**Status:** accepted
**Tags:** architecture, top-level-map

## Domains

| Domain | Path | Description |
|---|---|---|
| Web Frontend | `apps/web/` | React SPA — user interface for GEO configuration wizard, content management, and monitoring dashboards |
| API Server | `apps/server/` | Hono BFF — REST API layer, route handlers, middleware, schedulers, session health management |
| Dialogue Engine | `packages/dialogue-engine/` | 6-stage guided conversation state machine — drives the GEO configuration wizard flow |
| AI Engine | `packages/ai-engine/` | Content analysis — SEO scoring, readability, keyword recommendation, sentiment analysis (dual mode: rules + LLM) |
| Content Generator | `packages/content-generator/` | Article generation — builds platform-adapted content from session profile and keywords |
| Content Reviewer | `packages/content-reviewer/` | Quality review — 8-dimension content scoring (brand, compliance, originality, SEO, readability, etc.) |
| Publisher | `packages/publisher/` | Multi-platform publishing — RPA engine (Playwright), platform adapters, task queue, retry logic |
| Scraper | `packages/scraper/` | Web scraping — Cheerio for static pages, Puppeteer fallback for SPAs |
| Shared | `packages/shared/` | Shared types, interfaces, and constants — foundation dependency for all packages |
| Session Pool | `packages/session-pool/` | Browser session management — fingerprint isolation, session persistence and reuse |
| Account Vault | `packages/account-vault/` | Secure credential storage — encryption at rest for platform account credentials |
| Manual Generator | `packages/manual-generator/` | GEO configuration manual — Handlebars template-based document generation |
| Cookie Harvester | `harvester/` | Standalone RPA cookie harvesting service — Express + Puppeteer, Docker-deployed |

## Architecture style

Monorepo with **layered + modular** architecture:

```
┌─────────────────────────────────────────────────────┐
│                    apps/web (React)                  │  Presentation layer
├─────────────────────────────────────────────────────┤
│                   apps/server (Hono)                 │  API / BFF layer
├─────────────────────────────────────────────────────┤
│  packages/ — business logic (stateless, testable)    │  Domain layer
│  ┌────────┬──────────┬─────────┬─────────┬───────┐  │
│  │dialogue│ ai-engine │content-│content- │publisher│  │
│  │-engine │           │generator│reviewer │  + RPA │  │
│  └────────┴──────────┴─────────┴─────────┴───────┘  │
│  ┌─────────┬─────────┬──────────┬─────────────────┐  │
│  │ scraper │  shared │  manual  │ session-pool /  │  │
│  │         │ (types) │generator │  account-vault  │  │
│  └─────────┴─────────┴──────────┴─────────────────┘  │
├─────────────────────────────────────────────────────┤
│                   SQLite Database                    │  Data layer
└─────────────────────────────────────────────────────┘
```

## Key design principles

1. **Shared is the only leaf dependency** — all packages depend on `shared` for types; no package depends on `apps/server` or `apps/web`.
2. **Packages are pure logic** — no I/O, no side effects, fully testable in isolation. I/O happens at the `apps/server` layer.
3. **Repository pattern for data access** — SQL queries are encapsulated in repository classes, not scattered across route handlers.
4. **Schedulers are in-process** — all background work (publishing, health checks, cache cleanup) runs within the server process, managed by `scheduler.ts`.

## How to drill in

- **Architecture decisions** → see `adr/` directory (5 ADRs covering monorepo structure, Hono framework, dual-mode AI engine, SSE vs WebSocket, SQLite persistence)
- **Entry points** → see `architecture/entry-points.doc.md`
- **Running locally** → see `onboarding/running-the-project.guide.md`
- **Tech stack rules** → see `conventions/project-stack.rule.md`
