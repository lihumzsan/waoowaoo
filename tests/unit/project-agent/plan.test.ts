import { describe, expect, it } from 'vitest'
import {
  createProjectAgentPlanSnapshot,
  parseProjectAgentPlanSnapshot,
} from '@/lib/project-agent/plan'

describe('Project Agent active plan normalization', () => {
  it('closes a plan when every step is completed', () => {
    const completedPlan = {
      explanation: 'All work is complete.',
      plan: [
        { step: 'Prepare inputs', status: 'completed' },
        { step: 'Generate output', status: 'completed' },
      ],
    }

    expect(createProjectAgentPlanSnapshot(completedPlan)).toEqual({
      explanation: null,
      plan: [],
    })
    expect(parseProjectAgentPlanSnapshot(completedPlan)).toBeNull()
  })

  it('preserves a plan while any step remains unfinished', () => {
    const activePlan = {
      explanation: 'Continue with the remaining work.',
      plan: [
        { step: 'Prepare inputs', status: 'completed' },
        { step: 'Generate output', status: 'in_progress' },
      ],
    }

    expect(createProjectAgentPlanSnapshot(activePlan)).toEqual(activePlan)
    expect(parseProjectAgentPlanSnapshot(activePlan)).toEqual(activePlan)
  })
})
