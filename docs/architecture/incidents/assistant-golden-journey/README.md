<!-- architecture-incident: assistant-golden-journey -->

# Assistant Golden Journey Architecture Incident

## Classification and frozen baseline

This work is a class-D Architecture Incident. The production workflow passed
module-level review and required suites while the real story-to-video journey
failed at successive Assistant, workflow, persistence, task, SSE, and Canvas
handoffs.

The diagnostic baseline is Git commit
`fb7d2fa42121409a469c3adaaaefa0f64b2c1ba6`. The handoff intentionally moved
the incident's uncommitted diagnostic evidence into this independent worktree.
It is recorded in `root-cause-and-repair-plan.md` and `history-matrix.md` as
evidence, never as trusted baseline behavior or a patch stack to commit.

All incident-owned executable assets live under `tests/golden-journey/`.
Provider simulators, browser harness code, fixtures, scenario declarations,
oracles, and report schemas must not be distributed through production
modules. Production modules may only receive changes that establish a shared
runtime contract or remove a proven architecture defect.

## Goal

Build a zero-cost, deterministic, browser-driven proof that the real product
can move from an empty episode to a durable final deliverable through the
actual Next UI, React/ReactFlow, API routes, OpenAI Agents SDK runtime,
Operation registry, MySQL, Redis, queues, workers, Outbox continuations, SSE,
thread persistence, and reload recovery.

The same harness must also execute an exhaustive stage-transition matrix so
that an early serial failure does not hide defects in later workflow stages.
The first complete diagnostic run is evidence collection only: production
behavior is not repaired until every declared stage scenario has either
reached its expected terminal observation or produced a hard-block report.

## Non-goals

- This incident does not replace MySQL, Redis, BullMQ, the OpenAI Agents SDK,
  the Operation registry, production workers, SSE, or browser rendering with
  mocks.
- It does not call production Operation side-effect functions directly.
- It does not write business state from Playwright after scenario setup.
- It does not prove real paid-provider quality, rate-limit distributions, or
  model creativity. Those remain explicitly declared provider-boundary
  blind spots.
- It does not restore the deleted route or operation-specific continuation
  bypasses.
- It does not accept Browser Use or an AI browser operator as test evidence.

## Test topology and ownership

| Concern | Owner | Allowed test substitution |
| --- | --- | --- |
| Browser interaction and rendering | Playwright against real Chromium | None |
| Next routes and React application | production server build/runtime | None |
| Agent tool loop | OpenAI Agents SDK through production gateway | Local protocol-compatible HTTP model only |
| Workflow and Operation execution | production registry, resolver, invocation | None |
| Persistence | real MySQL schema and transactions | Isolated test data only |
| Async delivery | real Redis, queues, workers, Outbox | None |
| Client synchronization | real SSE and persisted Session/Thread endpoints | None |
| Image/video/audio generation | production provider adapters and workers | Local protocol-compatible HTTP providers returning valid tiny media |
| Test observations | browser events plus read-only database/log oracle | No business writes |

The source fixture is created through the real browser journey. Stage probes
use the production Workflow Lab API to fork a reached checkpoint; they do not
write domain tables directly. The diagnostic oracle uses a dedicated
`SELECT`-only database credential, and a self-test proves that a DDL write is
rejected. Only the production server and workers retain normal business write
authority.

Scenarios share one MySQL, Redis, and worker pool and isolate facts by unique
project/user/episode scope. This deliberately preserves cross-project routing
and worker-pool competition as observable behavior.

## Authoritative workflow coverage

The current fine-grained workflow identity is the `EditFirstWorkflowStage`
contract in `src/lib/project-workflow/edit-first.ts`. It is presently only a
TypeScript union, while the existing long-form runner and Workflow Lab each
maintain separate stage ordering. The existing runner already omits valid
production stages, so it cannot be a coverage authority.

This test-only phase does not alter the production workflow contract. Its
exhaustive stage list is checked at compile time against
`EditFirstWorkflowStage`; every stage is covered by the mainline, and every
currently checkpointable stable handoff is also mounted as a Workflow Lab
probe. A mount verifier runs Playwright discovery and fails when any declared
scenario lacks an executable test. Moving stage ordering to one production
runtime registry is deferred to the subsequent architecture-repair phase.

## Frozen test-only phase result

The frozen asset declares one full mainline, fourteen stable checkpoint
probes, three model-protocol variants, and four infrastructure/concurrency
contracts. It uses real Chromium, Next, Agent SDK, MySQL, Redis, workers,
Outbox, SSE, persistence, and reloads; only paid external providers are local.
The baseline independently reproduced both the ReactFlow maximum update-depth
failure and the exact legal Choice-consume stale watermark
(`expectedVersion=13 actualVersion=14`, `expectedEventSeq=13 actualEventSeq=14`).
The subsequent formal repair is recorded in the revised root-cause plan; it is
not part of the frozen baseline.

## AI-driven turn protocol decision

An authoritative workflow `nextAction` constrains the AI turn; it does not
authorize a server orchestrator to choose and invoke the next Operation. AI
initiates and drives all AI behaviour. The server persists and validates
Run/execution-segment/interaction/Task facts, and may start only the
durable recovery paths already owned by user controls or Task Outbox delivery.

After a successful tool call, a normally stopped model completes its current
AI turn. The server must preserve the completed handoff and leave the workflow
at its durable current stage. It must neither convert the remaining capability
into a Run failure nor execute `nextAction` deterministically. Completion,
Tool, persistence, ownership, and malformed-protocol failures remain explicit
failure outcomes. The superseding recurrence contract is
`../assistant-next-action-stop-recurrence-2026-07-12/README.md`.

## Persistent facts, writers, and projectors

| Fact | Existing/target unique writer | Consumer/projector |
| --- | --- | --- |
| Workflow stage and next directive | workflow resolver over durable domain facts | AI turn prompt/context, Session, Golden stage oracle |
| Operation domain write | `invokeProjectAgentOperation` registry authority | workflow resolver and resource projection |
| Execution eligibility | execution segment plus transaction fence | Operation/settlement commit barriers |
| Choice/Approval/Task handoff | `execution-handoff` | Session and Thread projectors |
| Assistant message plus Run outcome | `execution-handoff`/run settlement transaction | Thread UI |
| Task terminal continuation | durable Outbox worker | execution-handoff settlement |
| Canvas resource lifecycle | production resource and task facts through the canonical Canvas resolver | ReactFlow renderer |
| Browser-visible lifecycle | one canonical persisted identity projector | Playwright and user UI |

No Golden Journey helper may become another lifecycle writer or projector.

## Failure, retry, crash, and reload semantics

The scenario registry must declare its expected terminal semantics. A mainline
scenario fails on any API 4xx/5xx, console error, unhandled browser error,
failed Run/Activity/Task, duplicate persisted identity, invalid queue/worker
terminal state, or reload divergence. A failure-injection scenario may expect
a failed terminal fact, but only when that exact outcome and absence of partial
side effects are declared before execution.

The harness records all observations until the first hard blocker, rather than
discarding earlier console, projection, duplication, or persistence errors.
Fixed sleeps cannot establish correctness; waits are tied to browser state,
durable identities, task events, or explicit bounded deadlines.

## Old paths and duplicate authorities to remove

The implementation phase must delete, not preserve:

- hand-written workflow-stage orderings outside the single registry;
- tests that manufacture a second model turn instead of exercising the real
  Agent SDK/provider protocol;
- server executors, route bypasses, or test helpers that invoke an Operation
  merely because `nextAction` exists;
- fixture-local copies of production status strings;
- UI lifecycle deductions from message text, DOM content, or duplicate stream
  and persisted facts;
- any route, timer, polling loop, or test helper that becomes a second workflow
  continuation owner.

The existing API-only long-form runner may donate pure diagnostics, watchdog,
and report-format code, but it cannot remain a competing Golden Journey or
stage-coverage authority.

## Before/after authority counts

| Concern | Before | Target |
| --- | ---: | ---: |
| Runtime workflow-stage orderings | at least 3 (production type, E2E runner, Workflow Lab) | 1 registry |
| AI action initiators | model plus late runtime failure detector; historical route bypass removed | AI turn only; server retains only persistence, validation, and existing durable recovery owners |
| Golden product journey authorities | 0 browser-complete; 1 API-only partial runner | 1 Playwright harness plus registry-derived scenarios |
| Post-setup test business writers | API runner plus production services can drive controls; direct DB diagnostics available | production services only; oracle read-only |
| UI lifecycle interpretations | persisted Session/Thread plus remaining renderer/stream duplication candidates | 1 canonical persisted identity projection |

## Verification and completion levels

Implementation completion requires the harness, local providers, scenario
registry, read-only oracle, evidence report, and focused self-tests to exist.

Stage completion requires:

- the complete main journey and every declared stage transition to execute;
- known historical defects to have independent red/green proof;
- the first diagnostic matrix to be preserved;
- every row to have an expected outcome and collected evidence;
- no skipped scenario or unavailable dependency to be reported as success.

Architecture completion additionally requires the old authorities above to be
deleted, AI-driven turns to preserve and correctly classify their durable
handoffs, and the main journey and declared failure variants to pass through
reload checkpoints. Test scheduling in commit, push, PR, CI, or nightly
policy is deliberately outside this incident. Real paid-provider behavior
remains a named blind spot and prevents claims about provider quality, but not
about the verified product persistence protocol.
