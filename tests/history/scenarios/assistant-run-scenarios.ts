import {
  canTransitionProjectAgentRun,
  normalizeProjectAgentRunStatus,
} from '@/lib/project-agent/run-state-machine'
import type { ProjectAgentRunStatus } from '@/lib/project-agent/runs'
import {
  assertHistoricalValue,
  proveSemanticFaultRejected,
  type HistoricalRegressionScenario,
} from '../../harness/historical-regression'
import { runLifecycleSequence } from '../../harness/lifecycle-sequence'
import { assertAssistantToolWriteAuthority } from '@/lib/operations/write-authority'

type TransitionFacts = {
  readonly from: ProjectAgentRunStatus
  readonly to: ProjectAgentRunStatus
}

type TransitionStep = {
  readonly id: string
  readonly facts: TransitionFacts
  readonly expected: boolean
}

function runTransitionScenario(
  scenarioId: string,
  steps: readonly TransitionStep[],
  resolve: (facts: TransitionFacts) => boolean,
  recordExecution: (id: string) => void,
): void {
  runLifecycleSequence({
    scenarioId,
    steps,
    resolve,
    assertStep({ stepId, view, expected }) {
      assertHistoricalValue(view, expected, `${scenarioId}:${stepId}`)
    },
  }, { recordExecution })
}

function transitionScenario(
  id: string,
  steps: readonly TransitionStep[],
): HistoricalRegressionScenario {
  return {
    id,
    identity: id,
    defectId: 'BUG-AR-001',
    severity: 'P0',
    invariantIds: ['AR-02', 'AR-03'],
    historicalDefectIds: ['BUG-AR-001'],
    layers: ['regression'],
    async execute(context) {
      runTransitionScenario(id, steps, canTransitionProjectAgentRun, context.recordExecution)
    },
    async verifyFailBefore() {
      await proveSemanticFaultRejected(() => {
        runTransitionScenario(id, steps, () => true, () => undefined)
      })
    },
  }
}

const settlementDisconnect = transitionScenario('SCENARIO-ASSISTANT-SETTLEMENT-DISCONNECT', [
  { id: 'server-settles', facts: { from: 'running', to: 'completed' }, expected: true },
  { id: 'disconnect-arrives-late', facts: { from: 'completed', to: 'cancelled' }, expected: false },
])

const staleHeartbeatWriter = transitionScenario('SCENARIO-ASSISTANT-HEARTBEAT-STALE-WRITER', [
  { id: 'stale-run-cancelled', facts: { from: 'running', to: 'cancelled' }, expected: true },
  { id: 'old-heartbeat-cannot-revive', facts: { from: 'cancelled', to: 'running' }, expected: false },
])

const awaitingTaskReload: HistoricalRegressionScenario = {
  id: 'SCENARIO-ASSISTANT-AWAITING-TASK-RELOAD',
  identity: 'SCENARIO-ASSISTANT-AWAITING-TASK-RELOAD',
  defectId: 'BUG-AR-001',
  severity: 'P0',
  invariantIds: ['AR-01', 'AR-05'],
  historicalDefectIds: ['BUG-AR-001'],
  layers: ['regression'],
  async execute(context) {
    const restored = normalizeProjectAgentRunStatus('awaiting_task')
    assertHistoricalValue(restored, 'awaiting_task', 'reload preserves awaiting_task')
    assertHistoricalValue(
      canTransitionProjectAgentRun({ from: restored, to: 'running' }),
      true,
      'restored run can resume',
    )
    context.recordExecution(this.id)
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => {
      const incorrectlyRestored: ProjectAgentRunStatus = 'running'
      assertHistoricalValue(incorrectlyRestored, 'awaiting_task', 'reload preserves awaiting_task')
    })
  },
}

function assertUnsafeOperationWriteRejected(
  resolve: (operationId: string, operation: Record<string, unknown>) => void,
  recordExecution: (id: string) => void,
): void {
  const scenarioId = 'SCENARIO-ASSISTANT-OPERATION-WRITE-AFTER-LOCK-LOSS'
  let rejected = false
  try {
    resolve('unsafe_write', {
      channels: { tool: true, api: true },
      effects: { writes: true },
      confirmation: { kind: 'none', required: false },
      execute: async () => ({ committed: true }),
    })
  } catch {
    rejected = true
  }
  assertHistoricalValue(rejected, true, `${scenarioId}:ordinary write executor rejected`)
  recordExecution(scenarioId)
}

const operationWriteAfterLockLoss: HistoricalRegressionScenario = {
  id: 'SCENARIO-ASSISTANT-OPERATION-WRITE-AFTER-LOCK-LOSS',
  identity: 'SCENARIO-ASSISTANT-OPERATION-WRITE-AFTER-LOCK-LOSS',
  defectId: 'BUG-AR-001',
  severity: 'P0',
  invariantIds: ['AR-05A'],
  historicalDefectIds: ['BUG-AR-001'],
  layers: ['regression'],
  async execute(context) {
    assertUnsafeOperationWriteRejected(
      assertAssistantToolWriteAuthority,
      context.recordExecution,
    )
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => {
      assertUnsafeOperationWriteRejected(() => undefined, () => undefined)
    })
  },
}

export const ASSISTANT_RUN_HISTORICAL_SCENARIOS: readonly HistoricalRegressionScenario[] = [
  settlementDisconnect,
  staleHeartbeatWriter,
  awaitingTaskReload,
  operationWriteAfterLockLoss,
]
