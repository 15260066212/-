# ADR-005: SQLite + Repository pattern for persistence

**Type:** ADR
**Status:** accepted
**Tags:** architecture, database

## Context

The GEO system stores session data, articles, reviews, publish tasks, credentials, and user accounts. Initial user scale is small (< 1000 users, < 100K records). A full client-server database (PostgreSQL, MySQL) would add deployment complexity and cost for early-stage usage.

## Decision

Adopted SQLite (via `better-sqlite3`) as the primary database, with a repository pattern for data access. Each domain entity has its own repository class (e.g., `SessionRepository`, `ArticleRepository`) that encapsulates SQL queries. The `DatabaseAccess` class composes all repositories and provides cross-cutting concerns (transactions, health checks, connection lifecycle).

## Alternatives Considered

1. **PostgreSQL + Drizzle ORM** — rejected for initial launch because it requires a separate database server (or managed service), increasing deployment complexity and cost for a small user base. The schema is simple enough that SQLite handles it well.
2. **MongoDB** — ruled out because the data model is highly relational (sessions → articles → reviews → publish tasks → credentials) and ACID transactions are important for publish task state management.
3. **Prisma ORM** — rejected in favor of a hand-written repository pattern because Prisma adds a generation step and runtime overhead, and the query patterns are simple enough that raw SQL with thin repository wrappers is more transparent and easier to debug.

## Consequences

- Zero-config deployment: the database is a single file, no external service needed.
- `better-synchronous` is synchronous and fast for the current workload (< 1000 concurrent users).
- Repository pattern keeps SQL queries organized and testable.
- Migration to PostgreSQL is straightforward if needed: repository layer isolates SQL dialect differences.
- Not suitable for high-concurrency write-heavy workloads (SQLite has single-writer limitation).

## Superseded when

- Concurrent write load exceeds SQLite's single-writer capacity (roughly > 100 write transactions/second).
- The system needs advanced database features (JSONB, full-text search at scale, read replicas).
- Multi-server deployment requires a shared database that SQLite file cannot provide.
