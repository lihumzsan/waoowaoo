import { describe, expect, it } from 'vitest'
import { workspaceResourceGenerationTaskPayloadSchema } from '@/lib/workspace-resource/generation-contract'

const resource = (mediaType: 'video' | 'image') => ({
  resourceId: 'resource-1',
  workspacePath: `clips/${mediaType}.mp4`,
  mediaType,
  schemaId: mediaType === 'video' ? 'generic.video' : 'generic.image',
  inputHash: 'a'.repeat(64),
  prompt: 'A complete prompt.',
  modelKey: 'comfyui::minimax-h3-fast',
  inputs: [],
  imageInputPositions: [],
  audioInputPositions: [],
  videoInputPositions: [],
  toolCallId: null,
  sourceTurnId: null,
})

const basePayload = (mediaType: 'video' | 'image') => ({
  lifecycleProjection: {
    resources: [{ resourceId: 'resource-1', mediaType, schemaId: mediaType === 'video' ? 'generic.video' : 'generic.image', name: 'Clip' }],
  },
  protocol: 'workspace_resource_generation_v1' as const,
  resource: resource(mediaType),
  ...(mediaType === 'video' ? { videoModel: 'comfyui::minimax-h3-fast', durationSeconds: 4 } : { imageModel: 'codex::gpt-image-2' }),
  count: 1 as const,
  generationOptions: { resolution: '720p', generateAudio: true },
})

describe('frozen vocal performance task contract', () => {
  it('requires a vocal performance mode for video and keeps it outside provider options', () => {
    const parsed = workspaceResourceGenerationTaskPayloadSchema.parse({
      ...basePayload('video'),
      vocalPerformanceMode: 'native_dialogue',
    })
    expect(parsed.vocalPerformanceMode).toBe('native_dialogue')
    expect(parsed.generationOptions).not.toHaveProperty('vocalPerformanceMode')
    expect(() => workspaceResourceGenerationTaskPayloadSchema.parse(basePayload('video'))).toThrow()
  })

  it('forbids a vocal performance mode on non-video tasks', () => {
    expect(() => workspaceResourceGenerationTaskPayloadSchema.parse({
      ...basePayload('image'),
      vocalPerformanceMode: 'voiceover',
    })).toThrow()
  })
})
