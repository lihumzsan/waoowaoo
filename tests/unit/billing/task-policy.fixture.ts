import { describe, expect, it } from 'vitest'

import '@/lib/ai-providers'

import { TASK_TYPE } from '@/lib/task/types'

import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'

import type { TaskBillingInfo, TaskType } from '@/lib/task/types'

function expectBillableInfo(info: TaskBillingInfo | null): Extract<TaskBillingInfo, { billable: true }> {
  expect(info).toBeTruthy()
  expect(info?.billable).toBe(true)
  if (!info || !info.billable) {
    throw new Error('Expected billable task billing info')
  }
  return info
}

export { describe, expect, it } from 'vitest'
export { TASK_TYPE } from '@/lib/task/types'
export { getTaskDefinition } from '@/lib/task/definition'
export { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'
export type { TaskBillingInfo, TaskType } from '@/lib/task/types'
export { expectBillableInfo }
