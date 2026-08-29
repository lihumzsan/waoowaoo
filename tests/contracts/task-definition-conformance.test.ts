import { describe, expect, it } from 'vitest'
import { TASK_DEFINITIONS } from '@/lib/task/definition'
import { getEstimatedTaskProgressTiming } from '@/lib/task/estimated-progress'
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
      expect('billingPolicy' in definition).toBe(false)
      expect(definition.executionProtocol).toBe('handler_result_checkpoint')
      expect(definition.terminalSuccessHandoff).toBe('handler_result_checkpoint')
      expect(definition.submissionTargetOwnership).toBe('none')
      expect(definition.terminalResourceImpact).toBe('workspace_resources')
      expect(definition.terminalFailureProjector).toBe('none')
      expect(definition.terminalCancelProjector).toBe('none')
      expect(definition.terminalOutputMaterializer).toBe('workspace_resource')
      expect(TASK_DEFINITIONS[taskType].continuationResultProjection).toBe('reference')
      expect(TASK_DEFINITIONS[taskType].lifecyclePayloadProjection).toBe('reference')
    }
  })

  it('provides progress timing for every production TaskType', () => {
    for (const taskType of Object.values(TASK_TYPE)) {
      const timing = getEstimatedTaskProgressTiming(taskType)
      expect(timing, `${taskType} progress timing missing`).not.toBeNull()
    }
  })
})
