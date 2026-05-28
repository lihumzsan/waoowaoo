import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'

describe('billing/task-policy disabled mode', () => {
  it('treats every task type as non-billable', () => {
    for (const taskType of Object.values(TASK_TYPE)) {
      expect(isBillableTaskType(taskType)).toBe(false)
      expect(buildDefaultTaskBillingInfo(taskType, {
        analysisModel: 'anthropic/claude-sonnet-4',
        imageModel: 'seedream4',
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        maxSeconds: 10,
      })).toBeNull()
    }
  })
})
