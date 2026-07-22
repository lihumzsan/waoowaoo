import { describe, expect, it } from 'vitest'
import { normalizeTaskOperationResult, type OperationResultTaskRow } from '@/lib/task/operation-result-normalizer'
import { TASK_TYPE } from '@/lib/task/types'

function buildTask(overrides: Partial<OperationResultTaskRow>): OperationResultTaskRow {
  return {
    id: 'task-1',
    type: TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
    status: 'completed',
    targetType: 'CreativeResource',
    targetId: 'resource-1',
    episodeId: null,
    payload: {},
    result: {},
    errorCode: null,
    errorMessage: null,
    operationId: 'generate_creative_resource_audio',
    operationSource: 'assistant-confirmation',
    approvalGrantId: 'grant-1',
    operationExecutionId: 'execution-1',
    queuedAt: new Date('2026-05-02T01:00:00.000Z'),
    finishedAt: new Date('2026-05-02T01:01:00.000Z'),
    updatedAt: new Date('2026-05-02T01:01:00.000Z'),
    ...overrides,
  }
}

describe('normalizeTaskOperationResult', () => {
  it('normalizes completed music result with media/provider/model', () => {
    const result = normalizeTaskOperationResult(buildTask({
      result: {
        mediaId: 'media-1',
        audioUrl: 'https://cdn.example/music.mp3',
        storageKey: 'music/key.mp3',
        musicModel: 'google::lyria',
        provider: 'google',
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      operationId: 'generate_creative_resource_audio',
      taskId: 'task-1',
      status: 'completed',
      source: 'assistant-confirmation',
      approvalGrantId: 'grant-1',
      operationExecutionId: 'execution-1',
      provider: 'google',
      model: 'google::lyria',
      media: {
        mediaType: 'music',
        mediaId: 'media-1',
        url: 'https://cdn.example/music.mp3',
        storageKey: 'music/key.mp3',
      },
    }))
  })

  it('normalizes completed image result without exposing data urls', () => {
    const result = normalizeTaskOperationResult(buildTask({
      type: TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
      operationId: 'generate_creative_resource_image',
      payload: { imageModel: 'openai::image-model' },
      result: {
        imageUrl: 'data:image/png;base64,AAAA',
        imageMediaId: 'image-media-1',
      },
    }))

    expect(result?.media).toEqual({
      mediaType: 'image',
      mediaId: 'image-media-1',
    })
    expect(result?.model).toBe('openai::image-model')
  })

  it('normalizes completed video urls', () => {
    const video = normalizeTaskOperationResult(buildTask({
      type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      operationId: 'generate_creative_resource_video',
      result: { videoUrl: 'videos/panel.mp4' },
    }))

    expect(video?.media).toEqual({ mediaType: 'video', url: 'videos/panel.mp4' })
  })

  it('normalizes failed task error from task columns', () => {
    const result = normalizeTaskOperationResult(buildTask({
      type: TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
      operationId: 'generate_creative_resource_image',
      status: 'failed',
      result: null,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: 'provider returned no image',
      finishedAt: new Date('2026-05-02T01:02:00.000Z'),
    }))

    expect(result?.status).toBe('failed')
    expect(result?.error).toEqual({
      code: 'PROVIDER_ERROR',
      message: 'provider returned no image',
    })
  })

  it('normalizes processing task as active operation without result media', () => {
    const result = normalizeTaskOperationResult(buildTask({
      type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      operationId: 'generate_creative_resource_video',
      status: 'processing',
      result: null,
      finishedAt: null,
    }))

    expect(result).toEqual(expect.objectContaining({
      status: 'processing',
      media: null,
      completedAt: null,
    }))
  })

  it('returns null for tasks without operation metadata', () => {
    expect(normalizeTaskOperationResult(buildTask({ operationId: null }))).toBeNull()
  })
})
