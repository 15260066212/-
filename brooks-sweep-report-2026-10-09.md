# Brooks-Lint — Full Sweep Report

**Mode:** Full Sweep
**Scope:** packages/ai-engine/src/ (13 TypeScript files) + apps/server/.env.example (1 file) = 14 files total
**Config:** .brooks-lint.yaml applied (0 risks disabled, 7 paths ignored)

---

## Dimension Summary

| Dimension | Scanned | Safe Applied | Extended Applied | Reverted | Residual |
|-----------|---------|--------------|------------------|----------|----------|
| Review (R1–R6) | 13 files | 5 | 1 | 0 | 5 |
| Test (T1–T6)   | 1 test file + 13 source files | 0 | 0 | 0 | 2 |
| Debt           | 13 files | 0 | 1 | 0 | 2 |
| Audit          | 13 files | 0 | 0 | 0 | 3 |

**Totals:** 6 fixes applied (5 Safe + 1 Extended-Safe), 0 reverted, 7 residual items.

---

## Iteration History

| Round | Classification | New Findings | Fixes Applied | Stopped |
|-------|---------------|-------------|---------------|---------|
| Round 1 | Mixed (Warning + Suggestion) | 12 (0 Critical, 7 Warning, 5 Suggestion) | 6 (5 Safe + 1 Extended-Safe) | — |
| Round 2 | Clean round | 0 (no new findings from fixes) | 0 | ✅ Converged |

**Stopped at:** Clean round — all fixes verified, no new issues introduced.

---

## Fix Log

| # | File | Lines | Risk | Class | Outcome | Change |
|---|------|-------|------|-------|---------|--------|
| 1 | `ai-platform-service.ts` | L1 | R4-1 | Safe | applied | Removed unused `import https from 'https'` |
| 2 | `ai-platform-service.ts` | L1–L26 | R1-4 | Safe | applied | Extracted 7 magic numbers as named constants (DEFAULT_MAX_TOKENS, REQUEST_TIMEOUT_MS, MAX_RETRY_DELAY_MS, DOUBAO_MIN_OUTPUT_TOKENS, DEFAULT_TEMPERATURE, MAX_RETRY_ATTEMPTS, BASE_RETRY_DELAY_MS, RETRY_JITTER_MAX_MS) |
| 3 | `ai-platform-service.ts` | L123–L209 | R1-1 | Safe | applied | Refactored `buildRequestData` from 65-line if-ladder into switch dispatch + 6 private builder methods (`buildDoubaoRequest`, `buildDeepSeekRequest`, `buildQianwenRequest`, `buildKimiRequest`, `buildHunyuanRequest`, `buildDefaultRequest`) |
| 4 | `client.ts` | L107–L196 | R1-2 | Safe | applied | Split 90-line `chatCompletion` into 3 focused functions: main entry + `tryOpenAIResponsesApi` + `fetchChatCompletions` |
| 5 | `json-utils.ts` (new) | entire file | R3-1 | Extended-Safe | applied | Created shared JSON extraction utilities: `extractJsonObject`, `extractJsonArray`, `safeParseJsonObject`, `safeParseJsonArray` — with markdown fence stripping |
| 6 | `analyzer.ts` | L1, L76–L81 | R3-1 | Extended-Safe | applied | Replaced inline `response.match(/\{[\s\S]*\}/)` with `extractJsonObject()` |
| 7 | `validator.ts` | L1, L50–L55 | R3-1 | Extended-Safe | applied | Replaced inline `response.match(/\{[\s\S]*\}/)` with `extractJsonObject()` |
| 8 | `ppt-analyzer.ts` | L1, L70–L75 | R3-1 | Extended-Safe | applied | Replaced inline `response.match(/\{[\s\S]*\}/)` with `extractJsonObject()` |
| 9 | `keyword-recommender.ts` | L1, L73–L78 | R3-1 | Extended-Safe | applied | Replaced inline `response.match(/\[[\s\S]*\]/)` with `extractJsonArray()` |
| 10 | `sentiment-analysis-service.ts` | L1–L3, L65, L103–L107 removed | R3-1 | Extended-Safe | applied | Removed duplicate `extractJsonObject` class method; replaced call site with shared utility import |
| 11 | `visibility-analysis-service.ts` | L24–L59, L165–L206 | R1-3 | Safe | applied | Extracted 11 constants from `isRecommended`: 5 numeric (RECOMMEND_LOOKBACK_CHARS, RECOMMEND_LOOKAHEAD_CHARS, CLAUSE_LOOKBACK_CHARS, SHORT_LOOKAHEAD_CHARS, NEGATIVE_AFTER_LEEWAY_CHARS) + 6 regex patterns (NEGATIVE_BEFORE_PATTERN, NEGATIVE_AFTER_PATTERN, NEGATIVE_STRIP_PATTERN, POSITIVE_PATTERN, SENTENCE_PUNCTUATION, CLAUSE_PUNCTUATION) |

**Verification:** All 38 ai-engine tests pass, TypeScript type check passes with 0 errors.

---

## Health Score Delta

| | Before | After | Delta |
|---|--------|-------|-------|
| Health Score | **60/100** | **82/100** | **+22** |

**Breakdown of improvement:**
- 4 Warning findings resolved (−20 recovered: R1-1, R1-2, R1-3, R3-1)
- 2 Suggestion findings resolved (−2 recovered: R1-4, R4-1)

(Re-run `/brooks-health` for an exact recalculation across the full codebase.)

---

## Residual Items (7 not applied)

### 🟡 Warning

**1. Dual AI Client Architecture Split (R2-1 / R4-2 / Debt-2 / Audit-2)**

Symptom: `client.ts` follows a single-provider pattern with `getProviderConfig()`, while `ai-platform-service.ts` uses a multi-platform registry. Both manage environment variables, API keys, model names, and error handling independently.

Source: Brooks — The Mythical Man-Month (Conceptual Integrity); Fowler — Refactoring (Duplicate Code / Shotgun Surgery)

Consequence: Adding a new AI platform requires synchronized edits in two files. Developers must choose between two incompatible abstractions. Environment variable naming may drift over time.

Remedy: Unify under one architecture with clear separation between single-provider conversational use and multi-platform monitoring use. Share common configuration, request building, and error handling logic.

Not applied because: cross-module architectural change affecting public API surfaces; requires human design decision on the target architecture.

---

**2. Concrete Singleton Dependencies (R5-1 / Audit-1)**

Symptom: `sentiment-analysis-service.ts` directly imports `aiPlatformService` and `resultParserService` singleton instances. No interfaces, no dependency injection, no seam for testing.

Source: Martin — Clean Architecture (Dependency Inversion Principle); Feathers — Working Effectively with Legacy Code (Seam Model)

Consequence: SentimentAnalysisService cannot be unit-tested in isolation. Replacing the AI platform or result parser requires modifying production imports.

Remedy: Define interfaces for platform and parser services; accept dependencies via constructor parameters. Use a composition root to wire up singletons.

Not applied because: changes class signatures and public API; architectural decision with ripple effects.

---

**3. Seven Source Files with Zero Test Coverage (T5)**

Symptom: `ai-platform-service.ts`, `ppt-analyzer.ts`, `result-parser-service.ts`, `sentiment-analysis-service.ts`, `visibility-analysis-service.ts`, `citation-analysis-service.ts`, and `json-utils.ts` have no corresponding test files. 7 of 13 source files (54%) are untested.

Source: Feathers — Working Effectively with Legacy Code, Ch. 1: "Legacy code is code without tests"

Consequence: Any change to these services carries regression risk with no automated safety net. Complex logic in visibility-analysis and citation-analysis is especially vulnerable.

Remedy: Add characterization tests for each service, prioritized by complexity. Start with `visibility-analysis-service.ts` and `citation-analysis-service.ts` which have the most complex logic.

Not applied because: requires significant test infrastructure and test authoring effort; beyond automated fix scope.

---

**4. Enterprise Product Mapping Duplication (R3-2)**

Symptom: Both `analyzer.ts` and `ppt-analyzer.ts` contain identical `products.map((name) => ({ name, description: '', category: '', isPrimary: false }))` transformation logic.

Source: Fowler — Refactoring (Duplicate Code); Hunt & Thomas — The Pragmatic Programmer (DRY)

Consequence: If the EnterpriseProfile product structure changes, both files must be updated consistently.

Remedy: Extract a shared `mapProductNamesToProfile` helper function.

Not applied because: duplication is localized and small; adding a shared utility for 2 lines may be over-abstraction. Left for human judgment.

---

### 🟢 Suggestion

**5. analyzeResponse Long Method (R1-5)**

Symptom: `visibility-analysis-service.ts` `analyzeResponse` method is ~78 lines, mixing position calculation, scoring, competitor statistics, and share-of-voice computation in one pipeline.

Source: McConnell — Code Complete (Ch. 7: High-Quality Routines); Fowler — Refactoring (Long Method)

Consequence: Understanding the full data flow requires reading the entire method. Changes to one computation stage risk affecting others.

Remedy: Extract helper methods for each phase: `computeMentionPositions`, `computeVisibilityScore`, `buildCompetitorStats`, `computeShareOfVoice`.

Not applied because: internal refactoring with tightly coupled data flow; manual review of extraction boundaries recommended.

---

**6. Duplicate Brand/Competitor Type Definitions (R3-3)**

Symptom: `visibility-analysis-service.ts`, `citation-analysis-service.ts`, and `sentiment-analysis-service.ts` each define their own `Brand` and `Competitor` interfaces with overlapping but non-identical field sets.

Source: Evans — Domain-Driven Design (Ubiquitous Language); Fowler — Refactoring (Duplicate Code)

Consequence: Field names and optionality may drift across services. Types cannot be reused across analysis pipelines.

Remedy: Extract shared base types in a common module; each service extends with its specific fields via Pick/Omit or intersection.

Not applied because: field sets differ by service; unification requires careful type design. Design decision, not a mechanical fix.

---

**7. Anemic Service Pattern / Shallow Modules (R6-1 / Audit-3)**

Symptom: All analysis services are stateless transformer classes. `ResultParserService` in particular is a shallow module — a single method wrapped in a class with no state.

Source: Evans — DDD (Anemic Domain Model); Ousterhout — A Philosophy of Software Design (Shallow Module)

Consequence: Domain logic lives in service layers rather than domain objects. Class indirection adds overhead without encapsulation benefit.

Remedy: Consider converting simple utility services to plain function modules. Enrich domain types with behavior where appropriate.

Not applied because: this is a deliberate design choice — consistency across all services has value. Converting some but not others would reduce conceptual integrity.

---

## Summary

- **Total findings detected:** 12 (0 Critical, 7 Warning, 5 Suggestion)
- **Fixed this sweep:** 6 (5 Safe + 1 Extended-Safe), spanning 10 files
- **Residual (needs human review):** 7 (4 Warning, 3 Suggestion)
- **Unresolvable (3-retry exhausted):** 0
- **Tests verified:** 38/38 passing ✅
- **Type check verified:** 0 errors ✅
- **Iterations:** 2 rounds (1 main + 1 re-scan), converged clean

The most impactful improvements were: (1) eliminating JSON extraction duplication across 6 files via a shared utility, and (2) breaking up long methods in `ai-platform-service.ts` and `client.ts` into focused, readable functions. The highest-priority residual item is the dual AI client architecture split, which should be addressed through a deliberate design decision rather than automated refactoring.
