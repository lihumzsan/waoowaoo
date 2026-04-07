import { describe, expect, it } from 'vitest'
import { isBillableTaskType } from '@/lib/billing/task-policy'
import { getLLMTaskPolicy } from '@/lib/llm-observe/task-policy'
import { getTaskTypeLabel } from '@/lib/task/progress-message'
import { resolveTaskIntent } from '@/lib/task/intent'
import { TASK_TYPE } from '@/lib/task/types'

describe('prop modify task registration', () => {
  it('registers project prop modify tasks across task metadata helpers', () => {
    expect(resolveTaskIntent(TASK_TYPE.AI_MODIFY_PROP)).toBe('modify')
    expect(getTaskTypeLabel(TASK_TYPE.AI_MODIFY_PROP)).toBe('progress.taskType.aiModifyProp')
    expect(isBillableTaskType(TASK_TYPE.AI_MODIFY_PROP)).toBe(true)
    expect(getLLMTaskPolicy(TASK_TYPE.AI_MODIFY_PROP).consoleEnabled).toBe(true)
  })

  it('registers asset-hub prop modify tasks across task metadata helpers', () => {
    expect(resolveTaskIntent(TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP)).toBe('modify')
    expect(getTaskTypeLabel(TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP)).toBe('progress.taskType.assetHubAiModifyProp')
    expect(isBillableTaskType(TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP)).toBe(true)
    expect(getLLMTaskPolicy(TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP).consoleEnabled).toBe(true)
  })
})
