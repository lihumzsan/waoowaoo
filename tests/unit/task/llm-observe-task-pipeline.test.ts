import { describe, expect, it } from 'vitest'
import { getTaskFlowMeta, getTaskPipeline } from '@/lib/llm-observe/stage-pipeline'
import { getLLMTaskPolicy, isLLMTaskType } from '@/lib/llm-observe/task-policy'
import { TASK_TYPE } from '@/lib/task/types'

describe('llm observe task pipeline', () => {
  it('maps AI_CREATE tasks to standard llm policy', () => {
    const characterPolicy = getLLMTaskPolicy(TASK_TYPE.AI_CREATE_CHARACTER)
    const locationPolicy = getLLMTaskPolicy(TASK_TYPE.AI_CREATE_LOCATION)

    expect(characterPolicy.consoleEnabled).toBe(true)
    expect(characterPolicy.displayMode).toBe('loading')
    expect(characterPolicy.captureReasoning).toBe(true)

    expect(locationPolicy.consoleEnabled).toBe(true)
    expect(locationPolicy.displayMode).toBe('loading')
    expect(locationPolicy.captureReasoning).toBe(true)
  })

  it('registers edit bible generation as an llm task', () => {
    expect(isLLMTaskType(TASK_TYPE.EDIT_BIBLE_GENERATE)).toBe(true)
    expect(getLLMTaskPolicy(TASK_TYPE.EDIT_BIBLE_GENERATE).consoleEnabled).toBe(true)
  })

  it('maps AI_CREATE tasks to dedicated single-stage flows', () => {
    const characterMeta = getTaskFlowMeta(TASK_TYPE.AI_CREATE_CHARACTER)
    const locationMeta = getTaskFlowMeta(TASK_TYPE.AI_CREATE_LOCATION)

    expect(characterMeta.flowId).toBe('project_ai_create_character')
    expect(characterMeta.flowStageIndex).toBe(1)
    expect(characterMeta.flowStageTotal).toBe(1)

    expect(locationMeta.flowId).toBe('project_ai_create_location')
    expect(locationMeta.flowStageIndex).toBe(1)
    expect(locationMeta.flowStageTotal).toBe(1)
  })

  it('falls back to single-stage metadata for unknown task type', () => {
    const meta = getTaskFlowMeta('unknown_task_type')
    const pipeline = getTaskPipeline('unknown_task_type')

    expect(meta.flowId).toBe('single:unknown_task_type')
    expect(meta.flowStageIndex).toBe(1)
    expect(meta.flowStageTotal).toBe(1)
    expect(pipeline.stages).toHaveLength(1)
    expect(pipeline.stages[0]?.taskType).toBe('unknown_task_type')
  })
})
