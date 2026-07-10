import { describe, expect, it } from 'vitest'
import { confirmOperationPlan } from '@/lib/query/operation-plan-client'
import type { OperationPlanView } from '@/lib/operations/planning'

function plan(totalMaxFrozenCost?: number): OperationPlanView {
  return {
    operationId: 'regenerate_panel_image',
    kind: 'task_submission',
    taskCount: 1,
    tasks: [{
      id: 'planned-image',
      taskType: 'image_panel',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
    }],
    quote: {
      showCredits: totalMaxFrozenCost !== undefined,
      billingMode: totalMaxFrozenCost !== undefined ? 'ENFORCE' : 'OFF',
      billable: true,
      taskCount: 1,
      mediaTaskCount: 1,
      ...(totalMaxFrozenCost !== undefined
        ? { totalMaxFrozenCost, currency: 'credits' as const }
        : {}),
      items: [],
    },
  }
}

describe('confirmed operation plan client input', () => {
  it('binds the visible exact quote to the real user execution request', () => {
    expect(confirmOperationPlan(plan(3))).toEqual({
      confirmed: true,
      confirmedMaxCost: 3,
    })
  })

  it('still records explicit confirmation when self-hosted billing hides credits', () => {
    expect(confirmOperationPlan(plan())).toEqual({ confirmed: true })
  })
})
