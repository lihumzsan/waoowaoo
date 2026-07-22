import { describe, expect, it } from 'vitest'
import { isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_DEFINITIONS } from '@/lib/task/definition'
import { TASK_TYPE } from '@/lib/task/types'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { getTaskMaxAttempts } from '@/lib/task/retry-policy'

describe('TaskDefinition conformance', () => {
  it('registers every surviving TaskType exactly once and owns its complete policy', () => {
    const taskTypes = Object.values(TASK_TYPE).sort()
    expect(Object.keys(TASK_DEFINITIONS).sort()).toEqual(taskTypes)

    for (const taskType of taskTypes) {
      const definition = TASK_DEFINITIONS[taskType]
      expect(getQueueTypeByTaskType(taskType)).toBe(definition.queue)
      expect(getTaskMaxAttempts(taskType)).toBe(definition.maxAttempts)
      expect(definition.workerHandler.length).toBeGreaterThan(0)
      expect(isBillableTaskType(taskType)).toBe(definition.billingPolicy !== 'none')
      expect(definition.executionProtocol).toBe('handler_result_checkpoint')
      expect(definition.terminalSuccessHandoff).toBe('handler_result_checkpoint')
      expect(definition.submissionTargetOwnership).toBe('none')
      expect(definition.terminalResourceImpact).toBe('creative_resources')
      expect(definition.terminalFailureProjector).toBe('none')
      expect(definition.terminalCancelProjector).toBe('none')
    }
  })

  it('materializes Creative Work results and provider media through the Resource spine', () => {
    expect(TASK_DEFINITIONS[TASK_TYPE.CREATIVE_WORK]).toMatchObject({
      terminalOutputMaterializer: 'domain_creative_resource',
      continuationResultProjection: 'reference',
      lifecyclePayloadProjection: 'reference',
    })
    for (const taskType of [
      TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
      TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
      TASK_TYPE.CREATIVE_RESOURCE_VOICE,
      TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE,
    ]) {
      expect(TASK_DEFINITIONS[taskType].terminalOutputMaterializer).toBe('creative_resource')
    }
  })
})
