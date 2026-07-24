import { describe, expect, it } from 'vitest'
import { CreativeWorkerToolLifecycle } from '@/lib/creative-worker/tool-lifecycle'
import type { CreativeSkillReadTraceEntry } from '@/lib/creative-worker/types'

function trace(
  ordinal: number,
  skillId: CreativeSkillReadTraceEntry['skillId'],
): CreativeSkillReadTraceEntry {
  return {
    ordinal,
    source: 'tool',
    skillId,
    version: '1',
    uri: `skill://${skillId}/SKILL.md`,
    checksum: `checksum-${ordinal}`,
    contentChars: 100,
  }
}

describe('Creative Worker read_skill lifecycle', () => {
  it('settles parallel calls by opaque toolCallId even when outputs finish out of order', () => {
    const lifecycle = new CreativeWorkerToolLifecycle()
    lifecycle.begin({
      toolCallId: 'call-screenplay',
      toolName: 'read_skill',
      skillId: 'story-development',
    })
    lifecycle.begin({
      toolCallId: 'call-continuity',
      toolName: 'read_skill',
      skillId: 'continuity-memory',
    })
    const traces = [
      trace(1, 'continuity-memory'),
      trace(2, 'story-development'),
    ]

    expect(lifecycle.complete('call-continuity', traces)).toEqual({
      toolCall: {
        toolCallId: 'call-continuity',
        toolName: 'read_skill',
        skillId: 'continuity-memory',
      },
      trace: traces[0],
    })
    expect(lifecycle.complete('call-screenplay', traces)).toEqual({
      toolCall: {
        toolCallId: 'call-screenplay',
        toolName: 'read_skill',
        skillId: 'story-development',
      },
      trace: traces[1],
    })
    expect(() => lifecycle.assertSettled()).not.toThrow()
  })

  it('claims one trace per repeated same-Skill call', () => {
    const lifecycle = new CreativeWorkerToolLifecycle()
    lifecycle.begin({
      toolCallId: 'call-1',
      toolName: 'read_skill',
      skillId: 'quality-review',
    })
    lifecycle.begin({
      toolCallId: 'call-2',
      toolName: 'read_skill',
      skillId: 'quality-review',
    })
    const traces = [
      trace(1, 'quality-review'),
      trace(2, 'quality-review'),
    ]

    expect(lifecycle.complete('call-1', traces).trace.ordinal).toBe(1)
    expect(lifecycle.complete('call-2', traces).trace.ordinal).toBe(2)
    expect(() => lifecycle.assertSettled()).not.toThrow()
  })

  it('fails closed for duplicate, unknown, or unsettled identities', () => {
    const lifecycle = new CreativeWorkerToolLifecycle()
    const toolCall = {
      toolCallId: 'call-1',
      toolName: 'read_skill' as const,
      skillId: 'quality-review' as const,
    }
    lifecycle.begin(toolCall)

    expect(() => lifecycle.begin(toolCall)).toThrow('CREATIVE_WORK_RUN_FAILED')
    expect(() => lifecycle.complete('call-unknown', [])).toThrow('CREATIVE_WORK_RUN_FAILED')
    expect(() => lifecycle.complete('call-1', [])).toThrow('CREATIVE_WORK_RUN_FAILED')
    expect(() => lifecycle.assertSettled()).toThrow('CREATIVE_WORK_RUN_FAILED')
    expect(lifecycle.drainActive()).toEqual([toolCall])
    expect(() => lifecycle.assertSettled()).not.toThrow()
  })
})
