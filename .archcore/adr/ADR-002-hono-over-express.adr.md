# ADR-002: Hono as API framework (instead of Express)

**Type:** ADR
**Status:** accepted
**Tags:** architecture, backend, api-framework

## Context

The API server was initially planned with Express, the de facto Node.js standard. However, Express v4 (2026-09 current stable) is 200+ KB, does not natively support TypeScript types, and lacks first-class Edge Runtime support. The GEO server is primarily a BFF layer with lightweight business logic, making framework size and cold-start performance relevant.

## Decision

Adopted Hono as the API framework for `apps/server`. Hono is ~13 KB, has native TypeScript support, works on Node.js, Bun, Cloudflare Workers, and other edge runtimes, and provides built-in middleware for CORS, logging, and rate limiting.

## Alternatives Considered

1. **Express v4** — rejected because it is 15× larger (200 KB vs 13 KB), has weaker TypeScript support, and does not support edge runtimes natively.
2. **Fastify** — ruled out because while it offers better performance than Express, the overhead of its plugin ecosystem and schema validation approach is unnecessary for this BFF layer.
3. **NestJS** — rejected because the full DI + module system overhead is disproportionate to the server's complexity (~15 route files, no complex dependency injection needs).

## Consequences

- Server bundle size reduced by ~180 KB, improving cold-start time for serverless deployments.
- Middleware (auth, rate-limit, CORS, logging) are first-party Hono middleware with zero additional dependencies.
- Future migration to edge runtime (Cloudflare Workers, Vercel Edge Functions) is straightforward if needed.
- Smaller ecosystem than Express — some niche middleware may need custom implementation.

## Superseded when

- The server requires complex dependency injection or modular architecture that NestJS would handle better.
- Hono loses active maintenance or falls behind Express on critical security updates.
