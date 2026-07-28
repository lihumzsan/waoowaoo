import { describe, expect, it } from 'vitest'
import {
  createProjectAgentPlanSnapshot,
  parseProjectAgentPlanSnapshot,
} from '@/lib/project-agent/plan'

describe('Project Agent active plan normalization', () => {
  it('closes a plan when every step is completed', () => {
    const completedInput = {
      explanation: 'All work is complete.',
      plan: {
        state: 'completed',
        completed: ['Prepare inputs', 'Generate output'],
      },
    }

    expect(createProjectAgentPlanSnapshot(completedInput)).toEqual({
      explanation: null,
      plan: [],
    })
    expect(parseProjectAgentPlanSnapshot({
      explanation: 'All work is complete.',
      plan: [
        { step: 'Prepare inputs', status: 'completed' },
        { step: 'Generate output', status: 'completed' },
      ],
    })).toBeNull()
  })

  it('normalizes the structural authoring contract into the ordered persisted View', () => {
    const activeInput = {
      explanation: 'Continue with the remaining work.',
      plan: {
        state: 'active',
        completed: ['Prepare inputs'],
        active: 'Generate output',
        pending: ['Verify output'],
      },
    }
    const activeSnapshot = {
      explanation: 'Continue with the remaining work.',
      plan: [
        { step: 'Prepare inputs', status: 'completed' },
        { step: 'Generate output', status: 'in_progress' },
        { step: 'Verify output', status: 'pending' },
      ],
    }

    expect(createProjectAgentPlanSnapshot(activeInput)).toEqual(activeSnapshot)
    expect(parseProjectAgentPlanSnapshot(activeSnapshot)).toEqual(activeSnapshot)
  })

  it('rejects a persisted snapshot with more than one active step', () => {
    expect(() => parseProjectAgentPlanSnapshot({
      explanation: 'Invalid competing active steps.',
      plan: [
        { step: 'First active step', status: 'in_progress' },
        { step: 'Second active step', status: 'in_progress' },
      ],
    })).toThrow('PROJECT_AGENT_PLAN_MULTIPLE_IN_PROGRESS')
  })
})
