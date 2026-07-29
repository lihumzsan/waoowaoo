import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { shouldRequireInteractiveToolApproval } from '@/lib/project-agent/tool-approval-policy'
import { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'

function buildOperation(id: string) {
  return makeTestOperation({
    id,
    intent: 'query',
    effects: EFFECTS_NONE,
    confirmation: { kind: 'none', required: false },
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
  })
}

function buildBillableOperation() {
  return makeTestOperation({
    id: 'create_video',
    intent: 'act',
    effects: EFFECTS_BILLABLE,
    confirmation: { kind: 'billable_media', required: true },
    planContractRevision: 'tool-approval-policy/v1',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    plan: async () => ({
      kind: 'task_submission',
      operationId: 'create_video',
      projectId: 'project-1',
      userId: 'user-1',
      tasks: [],
    }),
    commit: async () => ({ ok: true }),
  })
}

describe('assistant tool approval policy', () => {
  it('keeps non-confirming operations interactive-approval free', () => {
    expect(shouldRequireInteractiveToolApproval({
      operation: buildOperation('get_project_context'),
      billingConfirmationRequired: true,
    })).toBe(false)
  })

  it('uses the billing setting only for billable operations', () => {
    const operation = buildBillableOperation()
    expect(shouldRequireInteractiveToolApproval({
      operation,
      billingConfirmationRequired: true,
    })).toBe(true)
    expect(shouldRequireInteractiveToolApproval({
      operation,
      billingConfirmationRequired: false,
    })).toBe(false)
  })
})
