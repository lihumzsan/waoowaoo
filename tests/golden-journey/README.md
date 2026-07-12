# Product Journey

This directory contains one repeatable Playwright product Journey and the
small security boundary that cannot be proved by the creative mainline.

The main Journey starts from an empty project, drives the real UI, API,
services, database, queue, workers, Outbox, SSE, and projector, and finishes
with a durable final video. Its deterministic local model produces at least
two chapters and multiple assets. The Journey reloads every core processing
stage and checks both the visible browser state and read-only database facts.

Only paid or uncontrollable external model and media providers are replaced.
The application being tested is never mocked. Playwright uses stable product
selectors; Browser Use and AI-selected elements are not test evidence.

The harness owns an isolated runtime identity for every run. That identity
selects dedicated MySQL and Redis scopes, ports, Next.js output, uploads, and
Playwright artifacts. Missing isolation, provider boundaries, scenario mounts,
or read-only Oracle permissions fail before product assertions are trusted.

Run the complete evidence set with:

```bash
npm run test:fast
npm run test:critical
npm run test:journey
```

`test:fast` contains pure logic and registry conformance. `test:critical`
contains real infrastructure failure, transaction, retry, idempotency, and
concurrency evidence. `test:journey` runs harness self-checks, then the one
multi-chapter mainline and the unauthenticated, cross-user, and cross-project
security scenarios. Playwright writes its JSON, HTML, trace, screenshot, and
video artifacts under `artifacts/golden-journey/runs/<run-id>/`.
