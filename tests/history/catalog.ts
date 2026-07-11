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
