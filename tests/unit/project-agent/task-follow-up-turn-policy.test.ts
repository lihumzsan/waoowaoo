import { describe, expect, it } from 'vitest'
import { resolveProjectAgentTaskFollowUpTurnPolicy } from '@/lib/project-agent/task-follow-up-turn-policy'

describe('task follow-up turn policy', () => {
  it('keeps failed recovery actions for a later user turn without executing them in the failure explanation turn', () => {
    const policy = resolveProjectAgentTaskFollowUpTurnPolicy('failed')

    expect(policy.allowOperationIntent('query')).toBe(true)
    expect(policy.allowOperationIntent('plan')).toBe(true)
    expect(policy.allowOperationIntent('act')).toBe(false)
    expect(policy.explanationSettlement).toBe('failed')
  })

  it('preserves the normal continuation contract for completed Tasks', () => {
    const policy = resolveProjectAgentTaskFollowUpTurnPolicy('completed')

    expect(policy.allowOperationIntent('act')).toBe(true)
    expect(policy.explanationSettlement).toBe('completed')
  })
})
