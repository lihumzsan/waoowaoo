# Product Journey

This directory contains repeatable free-composition Playwright product
Journeys and the small security boundary around them. Each creative Journey
starts from an empty project and invokes independent Operations from natural
language; no fixed stage sequence or recommended next action is part of the
test oracle. The primary free-composition Journey also proves that a Creative
Worker result materializes as an immutable Resource, one model-authored Choice
can commit only its current decision, Style Bible creation does not imply an
image preview, a missing frame ratio is resolved through that same Choice
protocol, the pending Choice survives refresh, and Chapters appear only after
explicit planning and adoption before becoming independent parallel Worker inputs.

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
concurrency evidence. `test:journey` runs harness self-checks, then the
independent resource-composition, parallel-operation, interruption, and
unauthenticated, cross-user, and cross-project security scenarios. Playwright writes its JSON,
HTML, trace, screenshot, and video artifacts under
`artifacts/golden-journey/runs/<run-id>/`.
