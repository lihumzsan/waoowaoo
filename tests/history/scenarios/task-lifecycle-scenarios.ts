import { ERROR_FAILURE_CLASS } from '@/lib/errors/codes'
import { buildTaskJobEnvelope } from '@/lib/task/job-envelope'
import { observeTaskJobAcrossQueues } from '@/lib/task/reconcile'
import { getTaskMaxAttempts, shouldRetryTaskFailure } from '@/lib/task/retry-policy'
import { TASK_TYPE } from '@/lib/task/types'
import {
  assertHistoricalValue,
  proveSemanticFaultRejected,
  type HistoricalRegressionScenario,
} from '../../harness/historical-regression'

const retryScenario: HistoricalRegressionScenario = {
  id: 'SCENARIO-TASK-ATTEMPT-FAILURE-THEN-RETRY',
  identity: 'SCENARIO-TASK-ATTEMPT-FAILURE-THEN-RETRY',
  defectId: 'BUG-TL-001',
  severity: 'P0',
  invariantIds: ['TL-02', 'TL-05'],
  historicalDefectIds: ['BUG-TL-001'],
  layers: ['regression'],
  async execute(context) {
    assertHistoricalValue(getTaskMaxAttempts(TASK_TYPE.IMAGE_PANEL), 3, 'image task attempt budget')
    assertHistoricalValue(shouldRetryTaskFailure({
      taskType: TASK_TYPE.IMAGE_PANEL,
      failureClass: ERROR_FAILURE_CLASS.TRANSIENT_PROVIDER,
    }), true, 'transient first attempt remains retryable')
    context.recordExecution(this.id)
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => {
      assertHistoricalValue(false, true, 'transient first attempt remains retryable')
    })
  },
}

const queueUnavailableScenario: HistoricalRegressionScenario = {
  id: 'SCENARIO-TASK-QUEUE-UNAVAILABLE-NO-WRITE',
  identity: 'SCENARIO-TASK-QUEUE-UNAVAILABLE-NO-WRITE',
  defectId: 'BUG-TL-001',
  severity: 'P0',
  invariantIds: ['TL-06B', 'TL-07'],
  historicalDefectIds: ['BUG-TL-001'],
  layers: ['regression'],
  async execute(context) {
    const observation = await observeTaskJobAcrossQueues('task-1', [
      { getJob: async () => { throw new Error('redis unavailable') } },
      { getJob: async () => undefined },
    ])
    assertHistoricalValue(observation, 'unavailable', 'infrastructure error is not job absence')
    context.recordExecution(this.id)
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => {
      assertHistoricalValue('absent', 'unavailable', 'infrastructure error is not job absence')
    })
  },
}

const absentRecoveryScenario: HistoricalRegressionScenario = {
  id: 'SCENARIO-TASK-ABSENT-JOB-RECOVERY',
  identity: 'SCENARIO-TASK-ABSENT-JOB-RECOVERY',
  defectId: 'BUG-TL-001',
  severity: 'P0',
  invariantIds: ['TL-06B'],
  historicalDefectIds: ['BUG-TL-001'],
  layers: ['regression'],
  async execute(context) {
    const observation = await observeTaskJobAcrossQueues('task-2', [{ getJob: async () => undefined }])
    assertHistoricalValue(observation, 'absent', 'clean queue observation permits recovery')
    const envelope = buildTaskJobEnvelope({
      id: 'task-2', parentTaskId: null, type: TASK_TYPE.IMAGE_PANEL,
      projectId: 'project-1', episodeId: 'episode-1', targetType: 'ProjectPanel', targetId: 'panel-1',
      payload: { panelId: 'panel-1', meta: { locale: 'zh', trace: { requestId: 'request-1' } } },
      batchKey: null, billingInfo: null, userId: 'user-1', operationId: 'generate_panel',
      operationSource: 'assistant', operationConfirmed: true, operationRequestId: 'request-1', priority: 7,
    })
    assertHistoricalValue(envelope.data.locale, 'zh', 'recovery preserves locale')
    assertHistoricalValue(envelope.data.operationId, 'generate_panel', 'recovery preserves operation')
    assertHistoricalValue(envelope.priority, 7, 'recovery preserves priority')
    context.recordExecution(this.id)
  },
  async verifyFailBefore() {
    await proveSemanticFaultRejected(() => {
      assertHistoricalValue(null, 'generate_panel', 'recovery preserves operation')
    })
  },
}

export const TASK_LIFECYCLE_HISTORICAL_SCENARIOS: readonly HistoricalRegressionScenario[] = [
  retryScenario,
  queueUnavailableScenario,
  absentRecoveryScenario,
]
