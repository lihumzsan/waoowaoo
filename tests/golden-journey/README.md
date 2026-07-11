# Golden Journey test architecture

This directory is the only home for the Assistant Golden Journey executable
test system.

```text
tests/golden-journey/
  contracts/   scenario identities, expected outcomes, stage coverage
  providers/   local protocol-compatible HTTP model/media services
  fixtures/    source manifest and production Workflow Lab checkpoint forks
  oracle/      read-only durable-state observations and cross-layer assertions
  browser/     Playwright fixtures, page objects, and browser observations
  journeys/    full mainline and registry-derived stage probes
  runtime/     environment, mount guard, network guard, and report writer
  self-tests/  tests proving the harness and guards fail closed
```

Production code may be imported for shared contracts and read-only parsing.
Golden Journey code must never be imported by production modules.

The browser and oracle cannot write business tables. The mainline creates its
source project through the real UI. Stage probes fork only through the
production Workflow Lab API, then all later mutations pass through the real
UI, API, Operation, queue, worker, Outbox, and SSE paths. The SQL oracle uses
a database account that is mechanically limited to `SELECT`.

Browser automation uses Playwright. Browser Use and AI-driven visual element
selection are prohibited.

The default provider gateway rejects paid calls by replacing model and media
boundaries with local protocol-compatible HTTP services. Browser requests to
non-loopback hosts are aborted and recorded as failures. Reports are written
to `artifacts/golden-journey/runs/<run-id>/` and appended to
`diagnostic-history.json`; a later run never replaces the historical scan.

Primary commands:

- `npm run test:golden:self`: harness self-tests plus mandatory mount proof.
- `npm run test:golden:mainline`: one real story-to-final-deliverable journey.
- `npm run test:golden:matrix`: mainline plus all checkpointable stage probes.
- `npm run test:golden:variant:*`: deterministic model/provider fault variants.
- `npm run test:golden:report`: latest matrix plus immutable run history.
