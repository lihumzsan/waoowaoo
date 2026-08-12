import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { isPlannedOperation } from '@/lib/operations/types'

describe('produce_voiceover_video operation contract', () => {
  it('is registered as the single planned voiceover entry point', () => {
    const operation = createProjectAgentOperationRegistryForApi().produce_voiceover_video
    expect(operation).toBeDefined()
    expect(operation?.id).toBe('produce_voiceover_video')
    expect(isPlannedOperation(operation!)).toBe(true)
    if (!isPlannedOperation(operation!)) throw new Error('voiceover operation must be planned')
    expect(operation.planContractRevision).toBe('produce_voiceover_video/v2')
    expect(operation.resourceContract.kind).toBe('resource')
    if (operation.resourceContract.kind !== 'resource') throw new Error('voiceover resource contract missing')
    expect(operation.resourceContract.outputMediaTypes).toEqual(['audio', 'video'])
  })

  it('rejects a request without frozen Resource versions', () => {
    const operation = createProjectAgentOperationRegistryForApi().produce_voiceover_video
    expect(operation?.inputSchema.safeParse({
      name: '旁白视频',
      video: { resourceId: 'video' },
      referenceAudio: { resourceId: 'reference' },
      voiceovers: [{ name: '第一段', text: '你好', language: 'zh', startSeconds: 0 }],
    }).success).toBe(false)
  })
})
