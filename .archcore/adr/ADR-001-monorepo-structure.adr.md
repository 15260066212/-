# ADR-001: Monorepo with npm workspaces + Turborepo

**Type:** ADR
**Status:** accepted
**Tags:** architecture, monorepo, build-system

## Context

The GEO system has multiple independent subsystems (dialogue engine, AI analysis, content generation, publishing, web frontend, API server) that share type definitions and utility code. A single-repo structure would create tight coupling and slow builds; a multi-repo setup would increase coordination overhead and make cross-package refactoring difficult.

## Decision

Adopted a monorepo structure using npm workspaces (native package management) with Turborepo as the build orchestrator. Shared logic lives in `packages/` (11 packages), deployable apps live in `apps/` (2 apps: web + server).

## Alternatives Considered

1. **Single monolithic app** — rejected because the publishing, AI, and dialogue subsystems have clearly separable responsibilities and would benefit from independent testing and reuse.
2. **Multi-repo with published npm packages** — ruled out because the team size is small (< 10 engineers) and the overhead of version management and cross-repo PRs would exceed the benefits.
3. **pnpm workspaces** — rejected in favor of npm workspaces because npm 10+ has sufficient workspace support and introducing another package manager adds onboarding friction.

## Consequences

- Cross-package refactoring is straightforward (single search-and-replace across the repo).
- Turborepo provides build caching, reducing CI time from ~5min to ~2min for incremental builds.
- All packages share TypeScript configuration via `tsconfig.base.json`, ensuring consistent compiler settings.
- [expected] As the team grows beyond 15 engineers, the monorepo may need more granular access controls and a more sophisticated release process.

## Superseded when

- The team grows beyond 20 engineers working on the same repository.
- A subsystem needs an independent release cadence from the main platform.
- Build times exceed 10 minutes even with Turborepo caching.
