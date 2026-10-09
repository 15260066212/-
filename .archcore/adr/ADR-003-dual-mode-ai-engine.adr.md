# ADR-003: Dual-mode AI engine (rules + LLM)

**Type:** ADR
**Status:** accepted
**Tags:** architecture, ai-engine

## Context

The GEO system performs various analyses on website content and user inputs: SEO scoring, readability analysis, keyword recommendation, brand tone analysis, etc. A pure LLM approach would require every user to provide an API key and would introduce latency and cost concerns. A pure rules-based approach would limit analysis quality for nuanced tasks like brand voice evaluation and natural language understanding.

## Decision

Implemented the `ai-engine` package with a dual-mode architecture: `rules` mode (offline rule engine, zero external dependencies) and `llm` mode (OpenAI-compatible API, enhanced analysis), with a `hybrid` mode that combines both. Rules handle 90% of structured analysis (keyword density, heading structure, link analysis); LLM handles subjective tasks (brand tone, content originality, natural language suggestions).

## Alternatives Considered

1. **LLM-only** — rejected because it would make the system unusable without an API key, raising the barrier to entry significantly. Users should be able to evaluate the product before committing to API costs.
2. **Rules-only** — ruled out because certain analysis dimensions (brand voice consistency, content originality detection) are difficult to encode as rules and would produce lower-quality results.
3. **Separate services** — rejected because for the current scale (< 1000 DAU), running rules and LLM in the same process is simpler and introduces no meaningful performance penalty.

## Consequences

- The product works out of the box with no API key required (rules mode), lowering onboarding friction.
- Users who provide an API key get enhanced analysis quality (hybrid mode), creating a clear upgrade path.
- Rule logic must be maintained alongside LLM prompts, adding some maintenance overhead.
- Testing is straightforward: rules engine has deterministic output; LLM mode uses mock responses in tests.

## Superseded when

- Rules engine maintenance cost exceeds LLM API cost savings.
- All target users have reliable access to LLM APIs and the offline mode is no longer needed.
