import { describe, expect, it } from 'vitest'
import { parseCreativeResourceGenerationTaskPayload } from '@/lib/creative-resource/generation-contract'
import { buildCreativeResourceRetryTaskPayload } from '@/lib/creative-resource/generation-retry'

function imagePayload() {
  return {
    lifecycleProjection: {
      resources: [{
        resourceId: 'resource:image-1',
        mediaType: 'image',
        schemaId: 'project.character_image',
        name: 'Character reference',
      }],
    },
    resource: {
      resourceId: 'resource:image-1',
      mediaType: 'image',
      schemaId: 'project.character_image',
      prompt: 'A character reference image.',
      modelKey: 'fal::gpt-image-2',
      inputHash: 'input-hash',
      inputs: [],
      imageInputPositions: [],
      audioInputPositions: [],
      videoInputPositions: [],
      generationOptions: {
        aspectRatio: '9:16',
        resolution: '1K',
        quality: 'high',
      },
      executionSegmentId: null,
      toolCallId: 'call-image-1',
    },
    imageModel: 'fal::gpt-image-2',
    videoModel: undefined,
    musicModel: undefined,
    voiceModel: undefined,
    prompt: undefined,
    previewText: undefined,
    language: undefined,
    durationSeconds: undefined,
    vocalMode: undefined,
    genre: undefined,
    mood: undefined,
    bpm: undefined,
    outputFormat: undefined,
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

  it('keeps context lineage separate from provider image inputs by exact position', () => {
    const payload = imagePayload()
    const parsed = parseCreativeResourceGenerationTaskPayload({
      ...payload,
      lifecycleProjection: {
        resources: [{
          resourceId: 'resource:video-voice-1',
          mediaType: 'video',
          schemaId: 'generic.video',
          name: 'Voice-conditioned video',
        }],
      },
      resource: {
        ...payload.resource,
        inputs: [
          {
            resourceId: 'r_AAAAAAAAAAAAAAAAAAAAAA',
            role: 'style_context',
            position: 0,
          },
          {
            resourceId: 'r_BBBBBBBBBBBBBBBBBBBBBB',
            role: 'reference',
            position: 1,
          },
        ],
        imageInputPositions: [1],
        audioInputPositions: [],
      },
    })

    expect(parsed.resource.inputs).toHaveLength(2)
    expect(parsed.resource.imageInputPositions).toEqual([1])
  })

  it('rejects provider image positions that do not identify a frozen Resource input', () => {
    const payload = imagePayload()
    expect(() => parseCreativeResourceGenerationTaskPayload({
      ...payload,
      resource: {
        ...payload.resource,
        imageInputPositions: [3],
      },
    })).toThrow()
  })

  it('freezes image and audio provider inputs as disjoint ordered position sets', () => {
    const payload = imagePayload()
    const parsed = parseCreativeResourceGenerationTaskPayload({
      ...payload,
      resource: {
        ...payload.resource,
        resourceId: 'resource:video-voice-1',
        mediaType: 'video',
        schemaId: 'generic.video',
        modelKey: 'openrouter::bytedance/seedance-2.0-fast',
        inputs: [
          {
            resourceId: 'r_CCCCCCCCCCCCCCCCCCCCCC',
            role: 'character',
            position: 0,
          },
          {
            resourceId: 'r_DDDDDDDDDDDDDDDDDDDDDD',
            role: 'character_voice',
            position: 1,
          },
        ],
        imageInputPositions: [0],
        audioInputPositions: [1],
      },
      imageModel: undefined,
      videoModel: 'openrouter::bytedance/seedance-2.0-fast',
    })

    expect(parsed.resource.imageInputPositions).toEqual([0])
    expect(parsed.resource.audioInputPositions).toEqual([1])
    expect(() => parseCreativeResourceGenerationTaskPayload({
      ...parsed,
      resource: {
        ...parsed.resource,
        audioInputPositions: [0],
      },
    })).toThrow()
  })

  it('changes only execution identity when rebuilding an exact failed Resource retry', () => {
    const frozenPayload = parseCreativeResourceGenerationTaskPayload({
      lifecycleProjection: {
        resources: [{
          resourceId: 'resource:video-1',
          mediaType: 'video',
          schemaId: 'generic.video',
          name: 'Original video',
        }],
      },
      resource: {
        resourceId: 'resource:video-1',
        mediaType: 'video',
        schemaId: 'generic.video',
        prompt: 'The original cinematic segment prompt.',
        modelKey: 'fal::video-model',
        inputHash: 'frozen-input-hash',
        inputs: [{
          resourceId: 'r_EEEEEEEEEEEEEEEEEEEEEE',
          role: 'reference',
          position: 0,
        }],
        imageInputPositions: [0],
        audioInputPositions: [],
        videoInputPositions: [],
        generationOptions: {
          duration: 15,
          aspectRatio: '16:9',
          resolution: '720p',
          generateAudio: true,
        },
        executionSegmentId: 'segment-original',
        toolCallId: 'call-original',
      },
      videoModel: 'fal::video-model',
      prompt: 'The original cinematic segment prompt.',
      count: 1,
      generationOptions: {
        duration: 15,
        aspectRatio: '16:9',
        resolution: '720p',
        generateAudio: true,
      },
    })

    const retryPayload = buildCreativeResourceRetryTaskPayload({
      frozenPayload,
      toolCallId: 'call-retry',
    })

    expect(retryPayload).toEqual({
      ...frozenPayload,
      resource: {
        ...frozenPayload.resource,
        executionSegmentId: null,
        toolCallId: 'call-retry',
      },
    })
    expect(retryPayload.resource.prompt).not.toContain('Retry the')
    expect(retryPayload.resource.inputs).toEqual(frozenPayload.resource.inputs)
    expect(retryPayload.generationOptions).toEqual(frozenPayload.generationOptions)
  })
})
