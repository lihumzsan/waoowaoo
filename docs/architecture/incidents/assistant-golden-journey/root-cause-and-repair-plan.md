# Assistant Golden Journey incident — revised root-cause and repair plan

## Governing decision

This is one class-D Architecture Incident. It spans the Assistant turn
protocol, durable interruption and task handoffs, operation invocation,
failure settlement, Canvas projection, and the Golden evidence that must
exercise them together.

**RC-1 is withdrawn.** An unresolved nextAction is not authority for a server
component to choose and invoke an Operation. All behaviour that is properly
initiated and driven by AI remains initiated and driven by an AI turn. The
server owns durable Run, execution-segment, interruption, Task, Outbox,
settlement, and recovery facts; it must not turn nextAction into a deterministic
execution queue or rename such an executor as a recovery loop.

Accordingly, a model that successfully calls a tool and then stops is an AI
turn-protocol failure: its prompt/context/tool surface, completion condition,
re-entry protocol, or failure expression is incomplete. nextAction may
constrain the AI turn, describe enabled capabilities, and validate a result,
but cannot itself cause a server-side invocation. The repair must make that
failure explicit and recoverable without creating a second action executor.

## Scope, non-goals, and ownership

The goal is to repair RC-2 through RC-7, preserving AI initiation of AI
behaviour. It does not reinstate deleted route side effects, add an operation
id branch, make a timer/refetch/poll own correctness, raise a fixed budget as
a correctness workaround, or decide when tests run in commit, push, PR, CI,
or nightly workflows.

| Surface | Current authority to preserve | Repair boundary |
| --- | --- | --- |
| AI turn | Agent SDK runtime and its tool protocol | AI chooses/calls an enabled operation; protocol must surface a stopped-but-obligated turn |
| Run and execution eligibility | execution segment plus Run fence/claim | A business waiting status cannot revoke a segment; a resumed answer creates or recovers its legal segment |
| Choice/Approval/Task wait | execution-handoff, interruption rows, Wait rows | One durable handoff and one consumption/settlement path per fact |
| Operation execution | invokeProjectAgentOperation plus Tool adapter and registry | One typed outcome is returned and switched on; callers do not infer it from output shape |
| Task failure | task engine, event reducer, Run settlement | The first terminal failure stays primary; later delivery/budget facts are diagnostics |
| Canvas | pure durable node projection, layout store, ReactFlow | Domain View, user layout, and transient measurement are distinct inputs |
| Golden evidence | production browser/services plus read-only oracle | Test helpers do not write lifecycle state or manufacture a second model turn |

## Historical and current evidence

The frozen baseline recorded a legal Choice consume with stale Run watermark
and a real ReactFlow controlled-state update loop. The 2026-07-11
execution-handoff convergence explicitly did not run its MySQL integration
suite because the local database was unavailable. Earlier tests therefore
proved local mechanisms but not the browser/Run/transaction/worker
combination.

The following were the observed baseline incident facts; their formal repair
status is recorded below:

- a durable Choice can be rejected because the old interruption creation
  watermark is reused after a legal Run event;
- a running-only heartbeat can treat a valid waiting Run as not running;
- generic invocation inferred Task/Noop behaviour from effects, suspendsFor,
  binding state, and output fields;
- `run.failed` could write failed over an already failed Run and replace the
  original error with a later wake-up/budget error;
- ReactFlow streaming could cause a projection → controlled nodes → measurement
  write → render feedback loop.

The following assertions are **not** accepted without new code-level and
reproducible evidence:

- approval snapshot immutability is missing (HEAD already has inputHash,
  snapshot.plan, FOR UPDATE, atomic grant consume, and batch transaction
  commit);
- signed media URL material is necessarily part of a provider fingerprint;
- locale, tool identity, or other stable identity defects share one root cause.

The model schema problem is confirmed but narrowly stated: a schema derived
from Zod currently makes optional fields nullable for the model, while runtime
safeParse rejects null. The formal repair is one centralized,
contract-constrained boundary normalizer (null to omitted/undefined only
where the canonical optional field permits it) followed by the original Zod
parser. It is not per-operation schema rewriting.

## Diagnostic-worktree hunk ownership inventory

The moved uncommitted changes are evidence, not a patch stack. Every hunk was
classified before formal editing:

| File / hunk | Classification | Disposition |
| --- | --- | --- |
| choice-card.ts Bible entity status comparison | proved local correction | retain: compare the canonical Bible entity status (`ready_for_review`), covered by the focused contract test; browser journey remains unverified |
| interruptions.ts current-fence reads | RC-2 evidence | replaced: lock current pending interruption and current Run fence, then atomically consume and append the decision execution segment |
| waits.ts current-fence read | no surviving imported hunk | no formal change in this stage; Task waits retain their existing durable receipt/claim contract |
| interruption-consume.test.ts changed fence expectation | RC-2 contract evidence | retain as a current-fence plus `run.execution_started` assertion; double-click browser proof remains blocked on infrastructure |
| execution-handoff.ts handoff locale lookup | diagnostic workaround | absent from the formal diff; no later locale reconstruction retained |
| server-follow-up.ts synthetic request locale header | diagnostic workaround | absent from the formal diff; no synthetic request context retained |
| persistence.ts removal of prior dynamic-tool parts | diagnostic workaround | absent from the formal diff; no history mutation retained |
| run-budget.ts configurable higher wake-up limit | diagnostic workaround | absent from the formal diff; no limit increase retained |
| invocation.ts result.noop shape exception | diagnostic workaround | replaced: only an approved plan that declares it may contain zero Tasks becomes `noop`; direct transactional Task operations fail closed without a committed receipt |
| planned-operation-invocation.ts removal of input-hash check | unsafe diagnostic change | absent from the formal diff; existing approval `inputHash` check remains authoritative |
| planning.ts / edit-script-ops.ts batch submission consolidation | candidate evidence | no bypass reproduced; existing approved-plan atomic path remains, with task binding only when its committed plan contains Tasks |
| edit-script-ops.ts / final-render-ops.ts nullable input fields | RC-4 evidence | replaced by the shared model-input normalizer; no per-operation null patches retained |
| edit-script-ops.ts effects change | ownership known but unproven | leave out of a formal RC repair unless registry semantics and an executable path prove it necessary |
| ProjectWorkspaceCanvas.tsx diagnostic bypass | diagnostic workaround | deleted and replaced with a pure projected View plus a separate user-layout overlay |
| Canvas dimension filtering and running-lifecycle measurement suppression | RC-6 evidence | deleted; ReactFlow measurement has no writer into domain/controlled source nodes |
| Canvas callback/options refactors | RC-6 supporting implementation | retained only for the one-way View/layout split; real ReactFlow streaming-resize proof remains blocked |
| Golden mainline reload/final-output assertions | RC-7 formal harness tightening | retained; it makes the final reload boundary stricter without altering a product oracle |
| Golden task-reload acceptance of an Approval boundary | diagnostic test relaxation | deleted; an unexpected boundary is still a failure |
| Golden oracle ordering change | read-only oracle correction | retained: the table has no `createdAt` ordering field, so the oracle no longer requests a non-existent order |
| Golden media fixture/audio and media-server protocol changes | harness correction | retained pending local-provider self-test; the self-test is infrastructure-blocked in this sandbox |
| Golden model fixture expansion and nullable structured value | RC-7/RC-4 fixture evidence | retained as provider protocol support; it never fabricates a server continuation |
| Golden wake-up environment override | diagnostic workaround | deleted |

No hunk is currently classified as unrelated or of unknown ownership. This
inventory will be updated when a candidate becomes a proved formal change or
is removed.

## Repair contracts

### RC-2 — Waiting outcome and execution eligibility

Waiting (awaiting_choice, awaiting_approval, awaiting_task) is a business
outcome, not an execution claim. The old segment ends normally when it commits
that waiting outcome. A user response locks the **current** pending
interruption and current Run fence, verifies the response identity and scope,
then creates or recovers the legal response execution segment. Creation
watermarks remain audit facts; they are not later commit capabilities.

Normal, duplicate, stale, cancelled, and recovery cases must be explicit:
the winning consumer creates one response segment; a second consumer returns
the defined conflict/idempotent result; a stale or superseded interruption
cannot create a segment; a crash after consume is recovered only through that
segment identity. No heartbeat allowlist is a repair.

### RC-3 — Exhaustive Operation outcome

The operation registry/invocation/Tool-adapter boundary must return exactly one
typed outcome, named to match the existing type system:

    completed
    noop
    submitted_tasks(non-empty canonical task identities)
    wait_choice
    wait_approval
    failed

The caller switches only on this outcome. effects.longRunning,
agentFlow.suspendsFor, Task batch binding, and output fields are declaration
inputs used to validate construction, not independent runtime result
interpreters. A `noop` does not bind a Task; `submitted_tasks` must have a
non-empty durable batch; choice and approval outcomes carry their durable
handoff intent.

### RC-4 — Only proved boundary convergence

Approval snapshot protection is a verification target, not a claimed missing
feature. A semantic-equivalence experiment must first isolate any unstable
provider-fingerprint field while changing only transport representation. The
shared nullable-input boundary is the only RC-4 implementation currently
authorized by evidence. Other identity/context changes require a concrete
reproduction and named owner before implementation.

### RC-5 — First terminal failure wins

Run failure transition must be a single expected-status CAS from a
non-terminal state. A later budget, wake-up, delivery, or recovery failure
cannot overwrite the first persisted terminal error. It is recorded as a
secondary diagnostic associated with the Run/attempt, without inventing a
large new FailureCause framework until a consumer needs one.

### RC-6 — Canvas one-way ownership

Streaming durable facts produce a pure node View. The layout store owns only
user position/disclosure/selection. ReactFlow owns measurement. Transient
dimension callbacks do not write into the durable View or controlled source
nodes. Validation mounts the actual controlled ReactFlow Canvas under streaming
and resize; a renderer bypass or measurement suppression is not valid evidence.

### RC-7 — Red/green real-chain evidence

Before changing a production semantic, record the failing artifact for the
corresponding real scenario. Required evidence includes: model stops after a
successful tool call; reload at every suspension; Choice and Approval double
submit; a settlement-boundary crash/controlled failure when the production
seam exists; and ReactFlow streaming resize. The same scenario must turn green
without changing its oracle to accept the former error.

The model-stop scenario asserts an explicit AI-turn protocol result: after the
successful tool call, the server must persist the completed/waiting handoff,
must not execute the next operation itself, and must surface a recoverable
AI-turn continuation requirement rather than rewrite the prior success as an
unrelated Run failure.

## Stage plan

1. **Evidence baseline.** Freeze clean-HEAD red artifacts and preserve the
   moved diagnostic diff as evidence. Do not merge diagnostic bypasses.
2. **RC-2 contract.** Introduce the response-segment/claim transaction and
   remove historical watermark authority from consumers.
3. **RC-3 contract.** Add the exhaustive outcome type and make invocation,
   adapters, handoff and wait code switch on it; delete output-shape inference.
4. **RC-5 contract.** Enforce first-terminal-failure-wins and attach secondary
   diagnostics without reopening/replacing the Run failure.
5. **RC-4 evidence-led work.** Verify approval protections; implement the
   centralized nullable boundary; run the semantic provider experiment before
   changing fingerprints.
6. **RC-6 ownership.** Replace Canvas feedback with one-way inputs and verify
   actual ReactFlow streaming/resize.
7. **RC-7 final validation.** Run only the directly relevant Golden,
   contract, integration, guard, and typecheck commands. Their scheduling in
   commit/push/PR/CI/nightly is deliberately outside this incident.

## Stage implementation and validation status

| Stage | Formal result | Direct evidence / remaining blind spot |
| --- | --- | --- |
| RC-2 | implemented | current Run/interruption locks and atomic decision execution segment; focused unit contract passes, but MySQL/browser double-submit is unavailable in this environment |
| RC-3 | implemented | exhaustive lower-case outcome union is produced at invocation/adapter boundary and consumed by an outcome switch; direct Task operations fail closed without a committed receipt |
| RC-4 | partially implemented | central nullable-input normalizer passes focused tests; approval snapshot defenses were verified in the existing path; no media-fingerprint change because semantic transport experiment is not executable here |

## 2026-07-12 recurrence — approval planning bypassed canonical invocation input

The default empty-project Golden mainline on `3866437c5` reproduced
`OPERATION_PLAN_INPUT_CHANGED` while resuming the approved
`generate_edit_style_previews` call. The approved Grant remained unconsumed,
no OperationExecution existed, and the already planned preview rows remained
pending. This invalidates the earlier RC-4 conclusion that the shared nullable
normalizer alone made planning and execution the same contract.

The recurrence crosses the Agents SDK approval callback, Operation planning,
snapshot hashing, RunState resume, and approved commit, so it remains a D-class
incident. The plan callback parsed and persisted the model input directly,
while approved execution first passed through `invocation.ts`, which also
injects the authoritative episode scope. The snapshot therefore hashed input
without `episodeId`; execution hashed the same business request with the
context-owned `episodeId`.

### Authority and transition

| Concern | Before | After |
| --- | --- | --- |
| Tool business-input preparation | approval preflight parse plus invocation parse | one preparation contract owned by `invocation.ts` |
| Environment/scope injection | approved execution only | planning and execution both resolve scope before parsing |
| Immutable snapshot input | preflight-local parsed value | canonical invocation-prepared value |
| Approval display hash | raw SDK arguments | persisted OperationPlanSnapshot input hash when a plan exists |
| Commit validation | canonical execution input versus preflight-local input | canonical execution input versus the same canonical planned input |

The repair must not weaken or bypass `inputHash`. It must delete the preflight
parser as an independent business authority and make the existing immutable
hash reject only a genuinely changed canonical request. The original
empty-project Mainline remains the fail-before and acceptance scenario.

### Failure and concurrency boundaries

- Invalid model input fails before a plan, Grant, preview write, Task, or
  OperationExecution is created.
- Approval rejection leaves the immutable plan unexecuted.
- Duplicate or late approval delivery remains serialized by the Grant row and
  OperationExecution identity; input normalization is not an idempotency
  mechanism.
- A process failure before the approved transaction commits leaves Grant,
  Execution, business projection, Tasks, billing freeze, and enqueue
  responsibility rolled back together.
- The repair does not authorize server-selected workflow continuation: it only
  executes the exact AI-requested, user-approved frozen call.

### Long-run wake-up budget false terminal

After the input and locale repairs moved the same default Mainline through BGM
generation, the Run failed with `PROJECT_AGENT_RUN_WAKEUP_BUDGET_EXCEEDED`
despite every observed Wait, Operation, Approval and Task completing normally.
The guard counted every `wait.followed` event for the entire user Run and
failed at ten. A valid story-to-final workflow has more than ten distinct Task
boundaries, so total workflow length was incorrectly used as evidence of a
loop.

The coarse Run wake-up counter is removed. Loop and retry protection remains
owned by durable identities: unresolved attempts for the same
`operationId + targetKey`, consecutive operation failures, one-time Wait
claims, execution segments, Grant/OperationExecution identity, and Task retry
policy. These contracts reject repetition of the same work without imposing a
maximum number of different successful workflow stages.

### Mainline recurrences after the original blocker

The same empty-project browser journey then exposed four additional lifecycle
contract errors that the previous simulated suites had not reached:

- Operation-owned Tasks treated locale as optional and guessed it from request
  payloads. Locale is now a required value from the canonical Operation
  context for every Task submission.
- Soundscape planning and generation shared one active-task count and one
  `audio_layers_generating` stage. They now have distinct planning, ready, and
  generation stages so durable reloads cannot appear to move backwards.
- Approval resume appended the same SDK tool-call identity to a second
  Assistant message. Thread persistence now advances the existing dynamic-tool
  part for that identity instead of creating a duplicate identity.
- Source-script expansion briefly created a Bible placeholder before its source
  relation was visible. Workflow projection now uses the durable Task type to
  distinguish source expansion from Bible generation instead of inferring a
  later stage from a partially materialized artifact.

### Canvas recurrence and one-way ReactFlow ownership

The real journey reproduced `Maximum update depth exceeded` only while active
Task stages were being reloaded. Two feedback mechanisms were present: the
Assistant focus effect cleared and immediately re-emitted the same parent
state on every dependency cleanup, and ReactFlow received dynamic controlled
node/edge props while also accepting imperative projection writes.

The repair makes parent focus notification semantic and separates ReactFlow
ownership. `defaultNodes/defaultEdges` are a frozen, mount-only bootstrap for
the official uncontrolled mode. All later business View and user-position
changes enter ReactFlow through one signature-gated instance writer. Measured
dimensions remain internal to ReactFlow and never enter the business
projection signature. The empty-project Mainline now reloads every processing
stage and the completed final output without a React update loop or an empty
post-reload Canvas.

### Real acceptance evidence

On 2026-07-12, after the recurrences above were repaired:

- `npm run typecheck` passed.
- `npm run test:golden:mainline` passed from a new empty project in 136.6s.
- The passing journey reached a durable final video, reloaded every observed
  Task suspension, reloaded the completed result, found no duplicate Message
  or tool-call identities, and reported no browser observation failures.
| RC-5 | implemented | terminal statuses no longer self-transition; a late `run.failed` is retained only as a persisted secondary diagnostic and cannot overwrite the primary failure |
| RC-6 | implementation complete, journey unverified | projection/user-layout/ReactFlow-measurement writers are separated; focused Canvas contract suite passes, but browser streaming-resize cannot start in this sandbox |
| RC-7 | scenario/oracle revised, journey unverified | model-stop scenario now rejects server `nextAction` execution and requires `PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED`; Playwright/local-provider servers cannot bind in this sandbox |

### Validation record (2026-07-12)

- Passed: `npm run typecheck`.
- Passed: the RC-2/3/4/5 focused Vitest selection (9 files, 59 tests), including
  current-fence interruption consumption, first-terminal-failure, typed stop
  outcomes, nullable input normalization, registry Noop declaration, and Bible
  entity-status alignment.
- Passed: the Canvas selection (5 files, 96 tests).
- Passed: direct registry conformance with
  `node --import tsx scripts/guards/operation-write-authority-registry.ts`, and
  the relevant continuation, Run-state, approval, Choice, SSE and Canvas guards.
- Not executed to a product result: the official full `check:architecture`
  reaches the operation registry guard but its `tsx` CLI cannot create an IPC
  socket under this sandbox (`EPERM`); the same registry script passes via the
  direct non-IPC command above.
- Infrastructure-blocked: the targeted Golden model-stop command cannot start
  Playwright's web server because the sandbox rejects `tsx` IPC sockets; the
  targeted interruption integration test cannot connect to MySQL
  `127.0.0.1:3307`. Neither is reported as a product pass or failure.

## Before/after authority changes

| Fact | Before repair | Target |
| --- | ---: | ---:|
| AI action initiators | AI turn plus proposed server executor in old plan | AI turn only |
| Run execution eligibility interpretations | historical interruption watermark, Run status, fence | one current response/execution claim transaction |
| Operation result interpreters | effects, flow metadata, bindings, output shapes | one typed outcome switch |
| primary terminal failure writers | reducer plus later same-status writers | one non-terminal-to-terminal CAS |
| Canvas measurement writers to controlled business nodes | ReactFlow callback and source-node state | none |

The repair is stage-complete only when each changed authority and its deletion
are covered by the named real evidence. It is not architecture-complete while
the unimplemented stages or named provider/fault-seam blind spots remain.
