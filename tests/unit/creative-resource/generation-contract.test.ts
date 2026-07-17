import { describe, expect, it } from 'vitest'
import { parseCreativeResourceGenerationTaskPayload } from '@/lib/creative-resource/generation-contract'

function imagePayload() {
  return {
    resource: {
      resourceId: 'resource:image-1',
      mediaType: 'image',
      schemaId: 'project.character_image',
      prompt: 'A character reference image.',
      modelKey: 'fal::gpt-image-2',
      inputHash: 'input-hash',
      inputs: [],
      generationOptions: {
        aspectRatio: '9:16',
        resolution: '1K',
        quality: 'high',
      },
      executionSegmentId: null,
      toolCallId: 'call-image-1',
    },
    imageModel: 'fal::gpt-image-2',
    count: 1,
    generationOptions: {
      aspectRatio: '9:16',
      resolution: '1K',
      quality: 'high',
    },
  } as const
}

describe('creative resource generation task contract', () => {
  it('accepts the persisted async external id envelope without adding it to the frozen input', () => {
    const parsed = parseCreativeResourceGenerationTaskPayload({
      ...imagePayload(),
      externalId: 'FAL:IMAGE:openai/gpt-image-2:request-1',
      stage: 'creative_resource_persist',
    })

    expect(parsed).toEqual(imagePayload())
    expect(parsed).not.toHaveProperty('externalId')
  })
})
