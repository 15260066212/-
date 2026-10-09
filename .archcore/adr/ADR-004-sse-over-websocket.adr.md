# ADR-004: HTTP + SSE instead of WebSocket for dialogue

**Type:** ADR
**Status:** accepted
**Tags:** architecture, frontend, realtime

## Context

The GEO configuration wizard uses a 6-stage guided dialogue between the user and the system. Each stage involves the user answering a question, the system validating and processing, then asking the next question. The interaction model is fundamentally request-response with progressive disclosure, not bidirectional real-time chat.

## Decision

Adopted HTTP + Server-Sent Events (SSE) for the dialogue interface. Each user message is a POST request; the server streams its response (thinking steps + final answer) via SSE. No WebSocket connection is maintained.

## Alternatives Considered

1. **WebSocket (Socket.IO)** — rejected because the interaction pattern is strictly request-response (one question, one answer per turn), not bidirectional chat. WebSockets add connection management complexity, heartbeat overhead, and deployment considerations (sticky sessions, connection limits) without benefit.
2. **Plain HTTP polling** — ruled out because SSE provides real-time streaming of the AI's "thinking" process, which gives better UX than waiting for a full response.
3. **gRPC streaming** — rejected because the team has no gRPC experience and the overhead of protobuf generation and tooling is not justified for a single dialogue endpoint.

## Consequences

- Simpler deployment: no sticky sessions required, works with any HTTP load balancer.
- The server is stateless per request, enabling easy horizontal scaling.
- SSE provides progressive rendering of AI responses, matching the "thinking aloud" UX pattern.
- Client-side implementation is simpler (EventSource API vs WebSocket connection management).
- Not suitable for true real-time features like collaborative editing or presence indicators.

## Superseded when

- The product adds real-time collaborative features requiring bidirectional communication.
- The dialogue model shifts to true multi-turn chat where either party can initiate a message.
