import { describe, expect, it } from 'vitest'
import { isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_DEFINITIONS } from '@/lib/task/definition'
import { TASK_TYPE } from '@/lib/task/types'
import { getTaskMaxAttempts } from '@/lib/task/retry-policy'

describe('TaskDefinition conformance', () => {
  it('registers every surviving TaskType exactly once and owns its complete policy', () => {
    const taskTypes = Object.values(TASK_TYPE).sort()
    expect(Object.keys(TASK_DEFINITIONS).sort()).toEqual(taskTypes)

    for (const taskType of taskTypes) {
      const definition = TASK_DEFINITIONS[taskType]
      expect(getTaskMaxAttempts(taskType)).toBe(definition.maxAttempts)
      expect(definition.executionHandler.length).toBeGreaterThan(0)
      expect(isBillableTaskType(taskType)).toBe(definition.billingPolicy !== 'none')
      expect(definition.executionProtocol).toBe('handler_result_checkpoint')
      expect(definition.terminalSuccessHandoff).toBe('handler_result_checkpoint')
      expect(definition.submissionTargetOwnership).toBe('none')
      expect(definition.terminalResourceImpact).toBe('workspace_resources')
      expect(definition.terminalFailureProjector).toBe('none')
      expect(definition.terminalCancelProjector).toBe('none')
      expect(definition.terminalOutputMaterializer).toBe('workspace_resource')
      expect(TASK_DEFINITIONS[taskType].continuationResultProjection).toBe('reference')
      expect(TASK_DEFINITIONS[taskType].lifecyclePayloadProjection).toBe('reference')
      expect(definition.executionDeadlineMs).toBeNull()
    }
  })
})
