import { describe, expect, it } from 'vitest'
import {
  BILLABLE_MEDIA_API_TYPES,
  isBillableMediaApiType,
  requiresBillableMediaApproval,
} from '@/lib/billing/media-approval-policy'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

function buildBillingInfo(apiType: Extract<TaskBillingInfo, { billable: true }>['apiType']): TaskBillingInfo {
  return {
    billable: true,
    source: 'task',
    taskType: TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
    apiType,
    model: 'provider::model',
    quantity: 1,
    unit: 'call',
    maxFrozenCost: 1,
    action: TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
    status: 'quoted',
  }
}

describe('billable media approval policy', () => {
  it('classifies every billable media type as the complete media approval set', () => {
    expect(BILLABLE_MEDIA_API_TYPES).toEqual(['image', 'video', 'music', 'voice'])
    for (const apiType of BILLABLE_MEDIA_API_TYPES) {
      expect(isBillableMediaApiType(apiType), apiType).toBe(true)
      expect(requiresBillableMediaApproval(buildBillingInfo(apiType)), apiType).toBe(true)
    }
  })

  it('does not require media approval for LLM text billing', () => {
    expect(isBillableMediaApiType('text')).toBe(false)
    expect(requiresBillableMediaApproval(buildBillingInfo('text'))).toBe(false)
  })
})
