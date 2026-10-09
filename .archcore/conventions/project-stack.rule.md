# Project stack

**Type:** Rule
**Status:** accepted
**Tags:** stack, conventions

- Full-stack TypeScript: write all code (frontend, backend, packages) in TypeScript with strict mode enabled.
- Monorepo via npm workspaces + Turborepo: shared packages under `packages/`, deployable apps under `apps/`.
- Backend: Hono on Node.js (not Express), better-sqlite3 for persistence with Drizzle-style repository pattern.
- Frontend: React 19 + Vite 6 + Zustand for state management. No Redux.
- Testing: Vitest across all packages and apps. Co-locate tests as `*.test.ts` next to source.
