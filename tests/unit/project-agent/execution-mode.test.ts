import { describe, expect, it } from 'vitest'
import { resolveProjectAgentExecutionMode } from '@/lib/project-agent/execution-mode'

describe('project agent execution mode', () => {
  it('defaults to auto when interactionMode is absent', () => {
    expect(resolveProjectAgentExecutionMode({})).toEqual({
      interactionMode: 'auto',
      effectiveIntent: 'act',
    })
  })

  it('uses plan intent in explicit plan mode', () => {
    expect(resolveProjectAgentExecutionMode({
      interactionMode: 'plan',
    })).toEqual({
      interactionMode: 'plan',
      effectiveIntent: 'plan',
    })
  })

  it('keeps act intent in fast mode', () => {
    expect(resolveProjectAgentExecutionMode({
      interactionMode: 'fast',
    })).toEqual({
      interactionMode: 'fast',
      effectiveIntent: 'act',
    })
  })
})
