import { describe, expect, it } from 'vitest'
import {
  buildAssistantRuntimeContractRevision,
} from '@/lib/assistant-runtime/runtime-contract'

const contractInput = {
  baseInstructions: 'base-v1',
  developerInstructions: 'developer-v1',
  runtimeSkills: [
    { skillId: 'video-direction', content: 'video-v1' },
    { skillId: 'music-direction', content: 'music-v1' },
  ],
} as const

describe('Assistant Runtime contract revision', () => {
  it('is stable for the same exact contract regardless of Skill enumeration order', () => {
    const expected = buildAssistantRuntimeContractRevision(contractInput)

    expect(expected).toMatch(/^[a-f0-9]{64}$/u)
    expect(buildAssistantRuntimeContractRevision({
      ...contractInput,
      runtimeSkills: [...contractInput.runtimeSkills].reverse(),
    })).toBe(expected)
  })

  it.each([
    {
      name: 'base instructions',
      input: { ...contractInput, baseInstructions: 'base-v2' },
    },
    {
      name: 'developer instructions',
      input: { ...contractInput, developerInstructions: 'developer-v2' },
    },
    {
      name: 'materialized Skill content',
      input: {
        ...contractInput,
        runtimeSkills: [
          contractInput.runtimeSkills[0],
          { skillId: 'music-direction', content: 'music-v2' },
        ],
      },
    },
  ])('changes when $name changes', ({ input }) => {
    expect(buildAssistantRuntimeContractRevision(input))
      .not.toBe(buildAssistantRuntimeContractRevision(contractInput))
  })
})
