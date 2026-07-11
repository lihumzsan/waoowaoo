import type { HistoricalDefect } from './types'

export const HISTORICAL_DEFECT_CATALOG = [
  {
    id: 'BUG-AR-001',
    commits: [
      '227b2d2880979e0452abdce132f3503123710849',
      '41c5a13a28b526df113d256c651753d8a6831a39',
      '59e74a164ed6b7a5efd690fa9c14b95a6e34af2d',
      'b9cf9c1a9c641658c29ced415cd4e9523d595977',
    ],
    symptom: 'Assistant runs can remain busy, settle twice, lose heartbeat ownership, or fail to recover after reload.',
    rootCause: 'Request, transport, persisted run, heartbeat, and wait facts were interpreted by multiple lifecycle writers instead of one server-owned run state machine.',
    severity: 'P0',
    module: 'assistant-run-lifecycle',
    invariantIds: ['AR-01', 'AR-02', 'AR-03', 'AR-05', 'AR-05A'],
    affectedLayers: ['integration-api', 'system', 'regression'],
    escapedLayers: ['unit', 'integration-api'],
    scenarioIds: [
      'SCENARIO-ASSISTANT-SETTLEMENT-DISCONNECT',
      'SCENARIO-ASSISTANT-HEARTBEAT-STALE-WRITER',
      'SCENARIO-ASSISTANT-AWAITING-TASK-RELOAD',
      'SCENARIO-ASSISTANT-OPERATION-WRITE-AFTER-LOCK-LOSS',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-TL-001',
    commits: [
      '95254ae71b934e52d6920b60e12aa6db5a606a58',
      '5756ba48c1930470b9871e6faf295e06b9e18cf5',
    ],
    symptom: 'A retryable worker attempt can project a final failed target or diverge from the durable Task lifecycle.',
    rootCause: 'Retry eligibility, worker attempt failure, Task terminal state, and business target projection were interpreted by more than one layer.',
    severity: 'P0',
    module: 'async-task-lifecycle',
    invariantIds: ['TL-02', 'TL-05', 'TL-06B', 'TL-07'],
    affectedLayers: ['integration-task', 'system', 'regression'],
    escapedLayers: ['unit', 'integration-task'],
    scenarioIds: [
      'SCENARIO-TASK-ATTEMPT-FAILURE-THEN-RETRY',
      'SCENARIO-TASK-QUEUE-UNAVAILABLE-NO-WRITE',
      'SCENARIO-TASK-ABSENT-JOB-RECOVERY',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-AR-002',
    commits: [
      'fac392c9909e12f1f0026b1a4712c5f485bf9041',
      'ea17800411cec79b4cff5e0e9f30ce16bbc8d6da',
    ],
    symptom: 'Concurrent terminal Tasks in one Assistant batch can both make progress yet leave the Wait and Run permanently awaiting_task.',
    rootCause: 'The Wait row was locked, but each terminal transaction reinterpreted the whole batch from a REPEATABLE READ Task snapshot instead of merging the current terminal event into the locked Wait aggregate.',
    severity: 'P1',
    module: 'assistant-run-lifecycle',
    invariantIds: ['AR-03C', 'AR-05'],
    affectedLayers: ['integration-task', 'regression'],
    escapedLayers: ['unit', 'integration-task'],
    scenarioIds: [
      'SCENARIO-ASSISTANT-CONCURRENT-TASK-TERMINAL-WAIT',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-CN-001',
    commits: [
      '6ef1a201ee6ff8e47336d3404ed8544ac0cf1bf8',
      '931ab59c3cfbafff99e0d68f63750d6872cdf6a7',
      'd31a5615bb460d41dc0efeddf9a5da0137a7470d',
    ],
    symptom: 'Canvas content can refresh twice, disappear at Task terminal, or be overwritten by stale stream runtime.',
    rootCause: 'DB resources, Task terminal facts, stream runtime, and cache mutation competed to hand off the final Canvas view.',
    severity: 'P0',
    module: 'canvas-node',
    invariantIds: ['CN-02', 'CN-04', 'CN-07', 'CN-08'],
    affectedLayers: ['integration-chain', 'system', 'regression'],
    escapedLayers: ['unit', 'regression'],
    scenarioIds: [
      'SCENARIO-CANVAS-TERMINAL-REFETCH-CANONICAL-RESOURCE',
      'SCENARIO-CANVAS-REPLAY-DUPLICATE',
      'SCENARIO-CANVAS-LATE-STREAM-AFTER-TERMINAL',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-PG-001',
    commits: [
      'ccdd10be674b8a8969fc236ce72b562437909f7f',
      '9207d4a3dc50f25eb0c0843a0d479f3f3215c48e',
    ],
    symptom: 'An external provider failure can remain pending or trigger an implicit model fallback.',
    rootCause: 'Provider terminal status, error classification, model selection, and fallback behavior were not enforced by one gateway contract.',
    severity: 'P0',
    module: 'provider-gateway',
    invariantIds: ['PG-01', 'PG-04', 'PG-05'],
    affectedLayers: ['integration-provider', 'integration-task', 'system'],
    escapedLayers: ['unit', 'integration-provider'],
    scenarioIds: [
      'SCENARIO-PROVIDER-FAILED-TERMINAL',
      'SCENARIO-PROVIDER-UNKNOWN-STATUS',
      'SCENARIO-PROVIDER-COMPLETED-WITHOUT-MEDIA',
      'SCENARIO-PROVIDER-ZERO-FALLBACK',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-PG-002',
    commits: [
      'a4aed5ba47af15788109094c74bac07a9b9cb516',
    ],
    symptom: 'A multi-candidate image Task can reuse the first candidate provider result for every candidate slot.',
    rootCause: 'The durable provider fence was correct, but the fan-out caller assigned every independent candidate the same invocation identity.',
    severity: 'P1',
    module: 'provider-gateway',
    invariantIds: ['PG-06', 'TL-13'],
    affectedLayers: ['unit', 'integration-task', 'regression'],
    escapedLayers: ['unit', 'integration-task'],
    scenarioIds: [
      'SCENARIO-PROVIDER-MULTI-CANDIDATE-IDENTITY',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-AR-003',
    commits: [
      '3c084eeb12084dce84b9e2a3422751800882a344',
    ],
    symptom: 'A durable Choice can correctly move its Run to awaiting_choice, then be reported as a failed Tool call and lose its streamed assistant reply on reload.',
    rootCause: 'The invocation fence conflated execution eligibility with business Run status: after a Choice atomically committed its Interaction and awaiting_choice transition, a post-invocation running check rejected that already-successful handoff.',
    severity: 'P0',
    module: 'assistant-run-lifecycle',
    invariantIds: ['AR-02B', 'AR-04A', 'AR-05A', 'AR-06', 'AR-07'],
    affectedLayers: ['unit', 'integration-task', 'system', 'regression', 'contract'],
    escapedLayers: ['unit', 'integration-task', 'system'],
    scenarioIds: [
      'SCENARIO-ASSISTANT-CHOICE-SUSPENSION-RECEIPT',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-AR-004',
    commits: [
      '55ef9f8184b1f791c0fc3eb2b19469cc762e72a9',
      '864438fc614169828327a504bb80e605cf6a2565',
    ],
    symptom: 'A task continuation can close its Activity more than once, reject a legitimate Choice or Approval handoff, and leave a failed tool message or incomplete reload view.',
    rootCause: 'The continuation Activity, checkpoint, message, Wait, Run, and Interaction were settled by separate adapter, interruption, and finalizer paths; the system used a Run fence as a late compensating check instead of one execution-segment handoff transaction.',
    severity: 'P0',
    module: 'assistant-run-lifecycle',
    invariantIds: ['AR-03B', 'AR-03E', 'AR-05A', 'AR-05B'],
    affectedLayers: ['unit', 'integration-task', 'system', 'regression', 'guard'],
    escapedLayers: ['unit', 'integration-task', 'system'],
    scenarioIds: [
      'SCENARIO-ASSISTANT-EXECUTION-HANDOFF-SINGLE-WRITER',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
  {
    id: 'BUG-CN-002',
    commits: [
      '340c33f6035cb8a00a7403bc815447b4c4ec169e',
    ],
    symptom: 'A visible Canvas node detail can recursively re-render until React reports Maximum update depth exceeded at the ReactFlow boundary.',
    rootCause: 'The shared renderer motion helper mirrored freshly-created React children into local state on every visible render, so ordinary children identity churn became a self-triggering state update loop.',
    severity: 'P1',
    module: 'canvas-node',
    invariantIds: ['CN-12'],
    affectedLayers: ['unit', 'regression', 'guard'],
    escapedLayers: ['unit'],
    scenarioIds: [
      'SCENARIO-CANVAS-MOTION-PRESENCE-VISIBLE-STABILITY',
    ],
    replayMode: 'semantic-fault-injection',
    status: 'protected',
  },
] as const satisfies readonly HistoricalDefect[]

export function validateHistoricalDefectCatalog(
  catalog: readonly HistoricalDefect[] = HISTORICAL_DEFECT_CATALOG,
): void {
  const ids = new Set<string>()
  const commits = new Map<string, string>()

  for (const defect of catalog) {
    if (ids.has(defect.id)) {
      throw new Error(`Duplicate historical defect id: ${defect.id}`)
    }
    ids.add(defect.id)

    if (defect.commits.length === 0) {
      throw new Error(`Historical defect ${defect.id} must reference at least one commit`)
    }
    if (defect.invariantIds.length === 0) {
      throw new Error(`Historical defect ${defect.id} must reference at least one invariant`)
    }
    if (defect.scenarioIds.length === 0) {
      throw new Error(`Historical defect ${defect.id} must reference at least one scenario`)
    }

    for (const commit of defect.commits) {
      if (!/^[0-9a-f]{40}$/.test(commit)) {
        throw new Error(`Historical defect ${defect.id} has an invalid full commit hash: ${commit}`)
      }
      const owner = commits.get(commit)
      if (owner) {
        throw new Error(`Commit ${commit} is assigned to both ${owner} and ${defect.id}`)
      }
      commits.set(commit, defect.id)
    }
  }
}
