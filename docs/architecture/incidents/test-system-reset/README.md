<!-- architecture-incident: test-system-reset -->

# Test System Reset Architecture Incident

## Classification and evidence

This is a class-D Architecture Incident. The repository accumulated hundreds of
test files and more than a thousand cases while real browser composition paths
continued to fail. The failure is systemic: product correctness has been
interpreted by file-level unit tests, mocked route tests, synthetic behavior
ledgers, source-string guards, historical scenario simulators, and a separate
browser journey.

The reset starts from the current `exp/assistant` worktree. Existing uncommitted
Golden Journey and production changes are outside this incident's ownership and
must be preserved.

## Goal

Make a small set of independently falsifiable tests the only executable product
evidence:

1. browser-driven Golden Journeys through the real UI and production runtime;
2. critical infrastructure scenarios for failures that are not economical or
   deterministic to inject from a browser;
3. pure logic specifications for algorithms, parsers, resolvers, reducers,
   policies, and canonical identity;
4. harness self-tests that prove the browser environment, local providers,
   read-only oracle, scenario mounts, and network restrictions fail closed;
5. minimal structural checks for architecture rules that are decidable without
   running product behavior.

## Non-goals and prohibited scope

- This phase does not decide when tests run in commit, push, pull-request,
  nightly, or release workflows.
- Git hooks and commit/push policy are unchanged.
- This phase does not repair product defects found by Golden Journey.
- Test count, case count, line coverage, mutation score, and directory coverage
  are not quality targets.
- Internal business layers may not be mocked to manufacture a product proof.
- Source-code text assertions and call-count-only assertions are not product
  behavior evidence.

## Test evidence ownership

| Evidence | Canonical owner | Allowed substitution | Consumer |
| --- | --- | --- | --- |
| User-visible workflow result | `tests/golden-journey/**` scenario registry and Playwright journey | Paid external providers only, through protocol-compatible local services | Developer and future CI policy |
| Durable workflow facts | production MySQL/Redis/queue/worker paths observed by the read-only Golden oracle | Isolated test data | Browser scenario assertions and diagnostics |
| Crash, retry, concurrency, transaction invariant | retained critical integration scenario | Controlled fault at an external/process boundary | Developer and future CI policy |
| Pure input/output contract | retained logic specification | None; the subject must be pure or isolated by an explicit contract | Developer |
| Architecture design and historical root cause | `docs/architecture/modules/**` and `docs/architecture/incidents/**` | None | Humans and agents |
| Harness integrity | Golden Journey self-tests and mount proof | Local deterministic infrastructure | Golden Journey runner |

Architecture documents own intent and invariants. Executable scenarios own
runtime evidence. No filename catalog, requirements matrix, test ledger, or
coverage score may become a competing interpretation of product correctness.

## Admission contract

A new executable test must name at least one source of authority:

- a user-visible critical journey or suspension boundary;
- an architecture invariant with a concrete failure outcome;
- a confirmed historical defect with pre-fix or controlled-fault red evidence;
- an exhaustive production registry contract;
- a pure logic contract with meaningful boundary or combinatorial behavior;
- a fail-closed test-harness invariant.

It must also identify the faulty implementation it rejects, use the production
entry appropriate to its class, assert a user result or authoritative fact, and
be mounted by a named command. Implementation and test may be delivered in one
change, but a corrective test must be demonstrated against pre-fix behavior or
an explicit semantic fault.

Changing a file, adding a route, or adding an instance does not automatically
authorize a new test file. Existing scenarios and exhaustive registries are
extended first. A B-class instance may add a scenario only when it introduces
a new observable result or failure semantic.

## Lifecycle and failure semantics

Golden Journeys start through the browser, mutate business state only through
production UI/API/service/worker paths, and finish at a declared user and
durable boundary. Reload, disconnect, retry, duplicate, late, concurrent,
cancel, reject, failure, and recovery variants use stable identities and
read-only observations. A timeout only bounds the run; it cannot establish
correctness.

Critical integration scenarios use real infrastructure and one controlled
fault seam. They must distinguish attempt failure from business terminal
failure and verify rollback, idempotency, ownership, and late/replay behavior
where applicable.

Pure logic specifications receive explicit facts and assert their complete
result. They may not mock a neighboring internal layer to simulate an
integration path.

Unavailable required infrastructure, an unmounted declared scenario, a skipped
required case, a paid external call, an oracle write, or an unexpected browser
error is an explicit failure.

## Transaction, retry, and crash ownership

Tests never own product transactions, retry policy, compensation, or recovery.
They invoke the production owner and observe its result. Golden setup may create
an initial checkpoint only through the production Workflow Lab contract; after
setup, all writes follow production paths. Critical integration setup may seed
isolated prerequisites, but the action under test must use its canonical
production entry.

## Old authorities and machinery to delete

- mocked unit/component/service tests without an independent domain oracle;
- mocked route suites and the route behavior ledger;
- synthetic historical scenarios whose fail-before proof supplies a fabricated
  wrong return value to the same assertion;
- source-string tests and source-scanning test-quality guards;
- requirements matrices that infer protection from registered scenario names;
- global mutation baseline and mutation-score gates;
- test-size, changed-file-to-test, route-test-count, and behavior-quality
  bureaucracy;
- `test:all` and suite aggregation that defines completeness by executing every
  legacy directory.

CI fail-closed behavior and required-run collection are useful capabilities,
but their existing Vitest-specific implementations are not automatically
preserved. The future execution-policy phase will mount the smallest mechanism
appropriate to the retained suites.

## Authority counts

| Concern | Before | Target after this phase |
| --- | ---: | ---: |
| Product behavior interpretations | unit, integration, system, regression, contract, history ledger, mutation, Golden Journey | Golden Journey plus explicitly admitted critical/logic evidence |
| Browser-complete journey owners | 1 | 1 |
| Historical defect authorities | TypeScript catalog plus synthetic registry plus incident documents | incident documents linked to real Golden/critical scenarios |
| Test completeness interpretations | file discovery, route catalog, task catalog, requirements matrix, changed-file guard, required-suite verifier | declared scenario mounts only; execution timing deferred |
| Mutation quality authorities | global Stryker baseline and ad-hoc historical faults | pre-fix or targeted controlled-fault evidence |

## Implementation stages

1. Freeze creation of legacy test types and record the reset contract.
2. Preserve Golden Journey and admitted real-infrastructure/pure-logic tests.
3. Delete self-proving tests, ledgers, source guards, mutation machinery, and
   their package/config/document references.
4. Rewrite repository and module governance around admission and falsification.
5. Verify retained configuration, typechecking, architecture-document mapping,
   Golden harness self-tests, and selected retained scenarios. Execution timing
   remains a declared blind spot for the later policy phase.

## Completion boundary and blind spots

This phase is complete when no repository rule requires a test merely because
code changed, old test-count machinery has no mounted authority, and retained
tests match one admitted class. It does not claim that every retained legacy
test is independently proven, that the full Golden matrix is green, or that a
new commit/push/CI schedule exists. Those are explicit follow-up stages.
